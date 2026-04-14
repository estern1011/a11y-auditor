#!/bin/bash
# Phase 3 + 4 + 5: Keyboard nav, forms, interactive components
# Runs on sprite env-2 in a single exec call
set -e
export PATH="$HOME/.bun/bin:/.sprite/languages/node/nvm/versions/node/v22.20.0/bin:$PATH"
cd $HOME/a11y-auditor

DRV="bun drivers/orca/driver.ts"

# Navigate fresh
$DRV navigate "https://dequeuniversity.com/demo/mars/"
sleep 2

echo "===== PHASE 3: KEYBOARD NAVIGATION ====="

echo "--- Skip nav check ---"
$DRV perform GO_TO_BEGINNING
$DRV next 2>&1 || true
echo "First item after beginning:"
$DRV item-text

echo ""
echo "--- Tab through page ---"
$DRV perform GO_TO_BEGINNING
for i in $(seq 1 30); do
  $DRV press Tab 2>&1 || true
  text=$($DRV item-text 2>&1) || true
  echo "Tab $i: $text"
done

echo ""
echo "--- Tab order transcript ---"
$DRV transcript 2>&1 || true

echo ""
echo "--- Screenshot of current focus ---"
agent-browser --cdp 9223 screenshot 2>&1 || true

echo ""
echo "===== PHASE 4: FORMS ====="

echo "--- Interactive snapshot ---"
agent-browser --cdp 9223 snapshot -i 2>&1 || true

echo ""
echo "--- Navigate to form fields ---"
$DRV perform GO_TO_BEGINNING
echo "--- Finding form controls ---"
for i in $(seq 1 15); do
  result=$($DRV perform FIND_NEXT_CONTROL 2>&1) || true
  echo "Control $i: $result"
  text=$($DRV item-text 2>&1) || true
  echo "  Item text: $text"
  if echo "$result" | grep -qi "not found\|no .* found\|error\|end of\|wrapped"; then
    break
  fi
done

echo ""
echo "--- Finding buttons ---"
$DRV perform GO_TO_BEGINNING
for i in $(seq 1 10); do
  result=$($DRV perform FIND_NEXT_BUTTON 2>&1) || true
  echo "Button $i: $result"
  text=$($DRV item-text 2>&1) || true
  echo "  Item text: $text"
  if echo "$result" | grep -qi "not found\|no .* found\|error\|end of\|wrapped"; then
    break
  fi
done

echo ""
echo "===== PHASE 5: INTERACTIVE COMPONENTS ====="

echo "--- Links inventory ---"
$DRV perform GO_TO_BEGINNING
for i in $(seq 1 15); do
  result=$($DRV perform FIND_NEXT_LINK 2>&1) || true
  echo "Link $i: $result"
  text=$($DRV item-text 2>&1) || true
  echo "  Item text: $text"
  if echo "$result" | grep -qi "not found\|no .* found\|error\|end of\|wrapped"; then
    break
  fi
done

echo ""
echo "--- Form scoped audit ---"
bun audit.ts "form" 2>&1 || true

echo ""
echo "--- Full transcript ---"
$DRV transcript 2>&1 || true

echo ""
echo "===== DONE ====="
