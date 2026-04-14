#!/bin/bash
# Phase 1 + 2: Automated baseline + Document structure
# Runs on sprite env-1 in a single exec call
set -e
export PATH="$HOME/.bun/bin:/.sprite/languages/node/nvm/versions/node/v22.20.0/bin:$PATH"
cd $HOME/a11y-auditor

DRV="bun drivers/orca/driver.ts"

# Navigate fresh
$DRV navigate "https://dequeuniversity.com/demo/mars/"
sleep 2

echo "===== PHASE 1: AUTOMATED BASELINE ====="
echo "--- Full audit (no tag filter) ---"
bun audit.ts 2>&1 || true

echo ""
echo "--- WCAG-only audit ---"
bun audit.ts --tags wcag2a,wcag2aa 2>&1 || true

echo ""
echo "===== PHASE 2: DOCUMENT STRUCTURE ====="

echo "--- Page title ---"
$DRV item-text

echo ""
echo "--- Headings ---"
$DRV perform GO_TO_BEGINNING
for i in $(seq 1 20); do
  result=$($DRV perform FIND_NEXT_HEADING 2>&1) || true
  echo "Heading $i: $result"
  if echo "$result" | grep -qi "not found\|no .* found\|error\|end of\|wrapped"; then
    break
  fi
done

echo ""
echo "--- Landmarks ---"
$DRV perform GO_TO_BEGINNING
for i in $(seq 1 15); do
  result=$($DRV perform FIND_NEXT_LANDMARK 2>&1) || true
  echo "Landmark $i: $result"
  if echo "$result" | grep -qi "not found\|no .* found\|error\|end of\|wrapped"; then
    break
  fi
done

echo ""
echo "--- Images ---"
$DRV perform GO_TO_BEGINNING
for i in $(seq 1 15); do
  result=$($DRV perform FIND_NEXT_IMAGE 2>&1) || true
  echo "Image $i: $result"
  if echo "$result" | grep -qi "not found\|no .* found\|error\|end of\|wrapped"; then
    break
  fi
done

echo ""
echo "--- Page stats ---"
$DRV perform READ_PAGE_STATS 2>&1 || true

echo ""
echo "--- Reading order (first 40 items) ---"
$DRV perform GO_TO_BEGINNING
for i in $(seq 1 40); do
  $DRV next 2>&1 || true
done

echo ""
echo "--- Full transcript ---"
$DRV transcript 2>&1 || true

echo ""
echo "--- Screenshot ---"
agent-browser --cdp 9223 screenshot 2>&1 || true

echo ""
echo "===== DONE ====="
