#!/usr/bin/env bash
set -euo pipefail

# These jobs explicitly remove host .NET, browser and database packages.
# Browser/device test jobs must keep their existing large-packages: false.
# Query dpkg first: an unavailable optional name makes apt reject the entire
# batch, even when the other requested packages are installed.
inventory=$(dpkg-query -W -f='${binary:Package}\t${db:Status-Status}\n')
packages=()
while IFS=$'\t' read -r package state; do
  if [[ "$state" != installed ]]; then
    continue
  fi
  case "${package%%:*}" in
    aspnetcore-*|dotnet-*|llvm-*|php*|mongodb-*|mysql-*|\
    azure-cli|google-chrome-stable|firefox|powershell|mono-devel|\
    libgl1-mesa-dri|google-cloud-sdk|google-cloud-cli)
      packages+=("$package")
      ;;
  esac
done <<< "$inventory"

if (( ${#packages[@]} > 0 )); then
  printf 'Removing %s installed large packages\n' "${#packages[@]}"
  sudo apt-get remove -y --fix-missing -- "${packages[@]}"
fi
sudo apt-get autoremove -y
sudo apt-get clean
