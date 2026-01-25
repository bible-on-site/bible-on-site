#!/bin/bash
# Initialize LocalStack S3 buckets for development and testing
# This script is run automatically when LocalStack starts

set -e

echo "=========================================="
echo "Initializing LocalStack S3 buckets..."
echo "=========================================="

# Dev bucket
echo "Creating dev bucket: bible-on-site-rabbis"
awslocal s3 mb s3://bible-on-site-rabbis 2>/dev/null || echo "  (already exists)"

# Test bucket
echo "Creating test bucket: bible-on-site-rabbis-test"
awslocal s3 mb s3://bible-on-site-rabbis-test 2>/dev/null || echo "  (already exists)"

# Set bucket policies for public read access
for bucket in bible-on-site-rabbis bible-on-site-rabbis-test; do
  echo "Setting public read policy for: $bucket"
  awslocal s3api put-bucket-policy --bucket $bucket --policy '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "PublicReadGetObject",
        "Effect": "Allow",
        "Principal": "*",
        "Action": "s3:GetObject",
        "Resource": "arn:aws:s3:::'$bucket'/*"
      }
    ]
  }'
done

echo "=========================================="
echo "LocalStack S3 initialization complete!"
echo "=========================================="
echo ""
echo "Buckets available:"
awslocal s3 ls
