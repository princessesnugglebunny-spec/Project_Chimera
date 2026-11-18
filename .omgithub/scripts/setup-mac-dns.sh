#!/usr/bin/env bash
set -euo pipefail

# GitHub-hosted Macs use Ethernet; the VM DNS proxy can retain NXDOMAIN
# for newly allocated Quick Tunnel names even after public resolvers answer.
/usr/bin/time -p sudo networksetup -setdnsservers Ethernet 1.1.1.1 8.8.8.8
/usr/bin/time -p sudo dscacheutil -flushcache
/usr/bin/time -p sudo killall -HUP mDNSResponder
/usr/bin/time -p networksetup -getdnsservers Ethernet
