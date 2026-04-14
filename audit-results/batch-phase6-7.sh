#!/bin/bash
# Phase 6 + 7: Visual review + remaining criteria
# Runs on sprite env-3 in a single exec call
set -e
export PATH="$HOME/.bun/bin:/.sprite/languages/node/nvm/versions/node/v22.20.0/bin:$PATH"
cd $HOME/a11y-auditor

DRV="bun drivers/orca/driver.ts"

# Navigate fresh
$DRV navigate "https://dequeuniversity.com/demo/mars/"
sleep 2

echo "===== PHASE 6: VISUAL + CROSS-REFERENCE ====="

echo "--- Screenshot ---"
agent-browser --cdp 9223 screenshot 2>&1 || true

echo ""
echo "--- A11y tree snapshot ---"
agent-browser --cdp 9223 snapshot -i 2>&1 || true

echo ""
echo "--- Focus indicator checks ---"
$DRV perform GO_TO_BEGINNING
for i in $(seq 1 10); do
  $DRV press Tab 2>&1 || true
  text=$($DRV item-text 2>&1) || true
  echo "Focus $i: $text"
done
echo "--- Screenshot at focus position ---"
agent-browser --cdp 9223 screenshot 2>&1 || true

echo ""
echo "--- Reflow test (320px) ---"
agent-browser --cdp 9223 execute "document.documentElement.style.maxWidth='320px'" 2>&1 || true
sleep 1
agent-browser --cdp 9223 screenshot 2>&1 || true

echo ""
echo "--- Text spacing test ---"
agent-browser --cdp 9223 execute "document.documentElement.style.maxWidth=''; document.body.style.lineHeight='1.5'; document.body.style.letterSpacing='0.12em'; document.body.style.wordSpacing='0.16em'; document.querySelectorAll('p').forEach(p => p.style.marginBottom='2em')" 2>&1 || true
sleep 1
agent-browser --cdp 9223 screenshot 2>&1 || true

echo ""
echo "===== PHASE 7: REMAINING CRITERIA ====="

# Reset page
$DRV navigate "https://dequeuniversity.com/demo/mars/"
sleep 2

echo "--- 1.1.1 Non-text content (images) ---"
$DRV perform GO_TO_BEGINNING
for i in $(seq 1 15); do
  result=$($DRV perform FIND_NEXT_IMAGE 2>&1) || true
  echo "Image $i: $result"
  text=$($DRV item-text 2>&1) || true
  echo "  Alt: $text"
  if echo "$result" | grep -qi "not found\|no .* found\|error\|end of\|wrapped"; then
    break
  fi
done

echo ""
echo "--- 2.4.1 Bypass blocks (skip nav) ---"
$DRV perform GO_TO_BEGINNING
$DRV next 2>&1 || true
echo "First element:"
$DRV item-text

echo ""
echo "--- 2.4.4 Link purpose ---"
$DRV perform GO_TO_BEGINNING
for i in $(seq 1 15); do
  result=$($DRV perform FIND_NEXT_LINK 2>&1) || true
  echo "Link $i: $result"
  text=$($DRV item-text 2>&1) || true
  echo "  Text: $text"
  if echo "$result" | grep -qi "not found\|no .* found\|error\|end of\|wrapped"; then
    break
  fi
done

echo ""
echo "--- Full transcript ---"
$DRV transcript 2>&1 || true

echo ""
echo "===== DONE ====="
