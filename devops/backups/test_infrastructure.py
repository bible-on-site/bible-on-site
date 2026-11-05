"""Protect the production boundaries and retention guarantees of the backup deployment."""

import unittest
from pathlib import Path

from cfnlint.decode import decode
import yaml

from mysql_backup import RETENTION

ROOT = Path(__file__).resolve().parents[2]


class InfrastructureTests(unittest.TestCase):
    def setUp(self):
        template, errors = decode(str(ROOT / "docs/aws/cloudformation/db-backups.yaml"))
        self.assertFalse(errors)
        self.template = template
        self.resources = template["Resources"]

    def test_bucket_retains_versions_privacy_and_encryption(self):
        resource = self.resources["BackupBucket"]
        self.assertEqual(resource["DeletionPolicy"], "Retain")
        self.assertEqual(resource["UpdateReplacePolicy"], "Retain")
        bucket = resource["Properties"]
        self.assertEqual(bucket["VersioningConfiguration"]["Status"], "Enabled")
        self.assertEqual(
            bucket["ObjectLockConfiguration"]["Rule"]["DefaultRetention"],
            {"Mode": "GOVERNANCE", "Days": 56},
        )
        self.assertTrue(all(bucket["PublicAccessBlockConfiguration"].values()))
        self.assertEqual(
            bucket["BucketEncryption"]["ServerSideEncryptionConfiguration"][0][
                "ServerSideEncryptionByDefault"
            ]["SSEAlgorithm"],
            "AES256",
        )
        rules = bucket["LifecycleConfiguration"]["Rules"]
        self.assertEqual(
            {
                rule["Prefix"].rstrip("/"): rule["ExpirationInDays"]
                for rule in rules
                if "Prefix" in rule
            },
            RETENTION,
        )
        policy = self.resources["BackupBucketPolicy"]["Properties"]["PolicyDocument"][
            "Statement"
        ][0]
        self.assertEqual(policy["Effect"], "Deny")
        self.assertEqual(policy["Condition"]["Bool"]["aws:SecureTransport"], "false")

    def test_writer_cannot_read_delete_bypass_retention_or_change_buckets(self):
        role = self.resources["BackupWriter"]["Properties"]
        trust = role["AssumeRolePolicyDocument"]["Statement"][0]["Condition"][
            "StringEquals"
        ]
        self.assertEqual(
            trust["token.actions.githubusercontent.com:sub"],
            "repo:bible-on-site/bible-on-site:ref:refs/heads/master",
        )
        statements = role["Policies"][0]["PolicyDocument"]["Statement"]
        actions = {
            action
            for statement in statements
            for action in (
                [statement["Action"]]
                if isinstance(statement["Action"], str)
                else statement["Action"]
            )
        }
        for forbidden in [
            "s3:GetObject",
            "s3:DeleteObject",
            "s3:DeleteObjectVersion",
            "s3:BypassGovernanceRetention",
            "s3:PutBucketPolicy",
            "ssm:PutParameter",
            "iam:PassRole",
        ]:
            self.assertNotIn(forbidden, actions)
        indexed = {s["Sid"]: s for s in statements}
        revocations = [
            s for s in statements if s["Action"] == "ec2:RevokeSecurityGroupIngress"
        ]
        self.assertEqual(len(revocations), 1)
        self.assertEqual(
            revocations[0]["Resource"],
            {
                "Fn::Sub": "arn:aws:ec2:${AWS::Region}:${AWS::AccountId}:security-group/${RdsSecurityGroupId}"
            },
        )
        # Each resource context is authorized separately. New-rule request tags
        # are absent when authorizing against the existing security group, so
        # the group statement scopes by region and VPC (matching the deployed
        # template); rule tagging is enforced on the rule/CreateTags contexts.
        self.assertEqual(
            indexed["LeaseOnlyTheDatabaseGroup"]["Condition"],
            {
                "StringEquals": {
                    "ec2:Region": "il-central-1",
                    "ec2:Vpc": "arn:aws:ec2:il-central-1:250598594267:vpc/vpc-0d6af72e472db138c",
                }
            },
        )
        for sid in ["CreateOnlyBackupRules", "TagOnlyNewBackupRules"]:
            tags = indexed[sid]["Condition"]["StringEquals"]
            self.assertEqual(tags["aws:RequestTag/Source"], "github-actions-build")
            self.assertEqual(tags["aws:RequestTag/Job"], "backup")
            self.assertIn("security-group-rule/", str(indexed[sid]["Resource"]))
        self.assertEqual(
            indexed["DecryptBackupCredentialOnly"]["Resource"], {"Ref": "SsmKeyArn"}
        )

    def test_workflow_is_opt_in_master_only_and_serialized_with_data_deploy(self):
        workflow = yaml.safe_load(
            (ROOT / ".github/workflows/db-backup.yml").read_text()
        )
        job = workflow["jobs"]["backup"]
        self.assertIn("PRODUCTION_BACKUPS_ENABLED == 'true'", job["if"])
        self.assertIn("refs/heads/master", job["if"])
        self.assertEqual(
            workflow["concurrency"]["group"], "${{ github.repository }}-cd-data"
        )
        self.assertFalse(workflow["concurrency"]["cancel-in-progress"])
        steps = job["steps"]
        # The setup action launches mysqld bound to all interfaces, so the
        # workflow must firewall port 3306 to loopback before it starts and
        # prove off-loopback refusal through a real interface — a peer network
        # namespace, since the runner's own addresses route over lo.
        firewall = next(
            i for i, s in enumerate(steps) if "iptables" in s.get("run", "")
        )
        setup = next(
            i for i, s in enumerate(steps) if "actions-setup-mysql" in s.get("uses", "")
        )
        verify = next(i for i, s in enumerate(steps) if "/dev/tcp" in s.get("run", ""))
        check = next(
            i
            for i, s in enumerate(steps)
            if s.get("run", "").endswith("mysql_backup.py check")
        )
        grant = next(
            i
            for i, s in enumerate(steps)
            if s.get("run", "").endswith("rds-build-access.mjs grant")
        )
        self.assertLess(firewall, setup)
        self.assertLess(setup, verify)
        self.assertLess(verify, check)
        self.assertLess(check, grant)
        self.assertIn("3306", steps[firewall]["run"])
        self.assertIn("netns", steps[verify]["run"])
        self.assertIn("127.0.0.1", steps[verify]["run"])
        self.assertEqual(steps[-1]["if"], "${{ always() }}")
        self.assertIn("rds-build-access.mjs cleanup", steps[-1]["run"])
        self.assertFalse(any("upload-artifact" in s.get("uses", "") for s in steps))

    def test_ci_requires_backup_tests_and_combines_their_coverage(self):
        workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
        cross = workflow["jobs"]["cross_module_ci"]
        self.assertIn("database_backups", cross["needs"])
        self.assertIn("needs.database_backups.result", cross["steps"][0]["run"])
        restore = next(
            s
            for s in cross["steps"]
            if s.get("name") == "Restore database backup coverage"
        )
        self.assertEqual(restore["with"]["path"], ".coverage/db-backup")
        package = (ROOT / "devops/package.json").read_text()
        self.assertIn("--require ../.coverage/db-backup/lcov.info", package)


if __name__ == "__main__":
    unittest.main()
