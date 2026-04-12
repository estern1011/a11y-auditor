#!/bin/bash
# Run auditor evaluation on all ACT test cases via the sprite environment.
# Uses: bun orca-driver.ts navigate, bun audit.ts, bun orca-driver.ts transcript
set -euo pipefail

SPRITE="orca-test"
DIR="/home/sprite/a11y-auditor"
RESULTS_DIR="$(dirname "$0")/results"
mkdir -p "$RESULTS_DIR"

run_sprite() {
  sprite exec --sprite "$SPRITE" --dir "$DIR" -- "$@" 2>&1
}

# Test cases: id|ruleId|wcag|expected|url
CASES=(
  "tc01|23a2a8|1.1.1|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/32bfac8a98cc212aa7bf9151bf40f665a7f51696.html"
  "tc02|23a2a8|1.1.1|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/38cc6a87fcc81fcc2248f0cd74ca48396b7aa432.html"
  "tc03|23a2a8|1.1.1|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/feb06eece7b158ab66a25bfa2c47a196309f0d93.html"
  "tc04|23a2a8|1.1.1|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/8006d1541dc71b93e6ec4d101a386e0043d1a521.html"
  "tc05|23a2a8|1.1.1|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/496963cfd35d4873c010469c47c84d4358fba035.html"
  "tc06|23a2a8|1.1.1|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/fef9a3ad8b2f2a6beeaf44ef7dafce08e743ea67.html"
  "tc07|59796f|1.1.1|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/59796f/8c29bcb24ac0f448846a2ffdad4c9693d5aef8c6.html"
  "tc08|59796f|1.1.1|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/59796f/b413c09531b239e27bcf79cb57302b429ef59fe6.html"
  "tc09|59796f|1.1.1|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/59796f/04342a3834e0003f3057807937d617e432e83d33.html"
  "tc10|59796f|1.1.1|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/59796f/5c71cdabc04f9038e21d872e20a516cb429a7619.html"
  "tc11|59796f|1.1.1|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/59796f/0bbd55ba8e418361f99f717418206a37d57fd978.html"
  "tc12|e086e5|1.3.1|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/e086e5/933cad4e69415e2a2970832d2d60e2b854bca1b4.html"
  "tc13|e086e5|1.3.1|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/e086e5/366e62d83ede9df9fdad86cf7040600916bb065a.html"
  "tc14|e086e5|1.3.1|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/e086e5/6726b79b0534d80f567c3e5fd7174962d411be95.html"
  "tc15|e086e5|1.3.1|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/e086e5/004258203c8bf167307b6ed79f765115d16a6357.html"
  "tc16|e086e5|1.3.1|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/e086e5/5c0ba53d53cc9fd8627f224b39db30bd9ffa5757.html"
  "tc17|e086e5|1.3.1|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/e086e5/80a5df2346e082cd0be260143ac9090a902bcf30.html"
  "tc18|afw4f7|1.4.3|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/afw4f7/fd406bedf0bb3bdc4c2a718f49a3dd0f7aaa7556.html"
  "tc19|afw4f7|1.4.3|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/afw4f7/ab4691ef474d6263e9ceec824f07faa51a30112e.html"
  "tc20|afw4f7|1.4.3|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/afw4f7/dc170fd015758b62d8e0141e086893a116ee724e.html"
  "tc21|afw4f7|1.4.3|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/afw4f7/eaf0a926896f045a498073da42ea6263a4d6d36c.html"
  "tc22|afw4f7|1.4.3|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/afw4f7/e8f3acb1dc814b8b815c69b7150cdea67d5bd98e.html"
  "tc23|afw4f7|1.4.3|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/afw4f7/41afaa9b33287aba9c608c3466e2b164f57a02ed.html"
  "tc24|047fe0|2.4.1|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/047fe0/c67821f1bd796c8dcabd5fd32c647780fa324e27.html"
  "tc25|047fe0|2.4.1|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/047fe0/9b25d8065dc0ba59bf1c282efb27dcd81298fed4.html"
  "tc26|047fe0|2.4.1|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/047fe0/8e7af0a95841a94b2d1dbee0860b4719c2085945.html"
  "tc27|047fe0|2.4.1|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/047fe0/7505d097f7d59d71dc7eb8f7ab82c5682def54d4.html"
  "tc28|047fe0|2.4.1|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/047fe0/81d501e52085d9e5712e241bdd24708e7cb4a301.html"
  "tc29|047fe0|2.4.1|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/047fe0/929079705b1789667853e023b818eb4101630700.html"
  "tc30|c487ae|2.4.4|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/c487ae/a8cc66de4d60e34c7ee0d09fd6ab965ac23d9b4f.html"
  "tc31|c487ae|2.4.4|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/c487ae/d761116217a5875490cd7a2adf0219bdb1bff5cf.html"
  "tc32|c487ae|2.4.4|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/c487ae/ada7438401aba500eb03f678b05b9821a758336a.html"
  "tc33|c487ae|2.4.4|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/c487ae/97b115a032fc4178230306e2d0f4e334b2cfe8a9.html"
  "tc34|c487ae|2.4.4|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/c487ae/633d9136ef3e040b7653b287651c65e4302fe417.html"
  "tc35|c487ae|2.4.4|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/c487ae/954326e5ba700d4616d924807f427002816e9fc3.html"
  "tc36|97a4e1|4.1.2|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/97a4e1/a4cc71b0434f71f4ea0069c409f73e0207dfb403.html"
  "tc37|97a4e1|4.1.2|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/97a4e1/d9adf41033a5b71a0730b6df8c1c7e01088e9022.html"
  "tc38|97a4e1|4.1.2|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/97a4e1/3004e7b1a47b2e5a5c77b3eef36b50d495c9e4a1.html"
  "tc39|97a4e1|4.1.2|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/97a4e1/1ec8deb0b18514b612774d3af39b5ad41f2a792b.html"
  "tc40|97a4e1|4.1.2|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/97a4e1/2c5b0625e21b3503d1cd4c4daf53b15ae41c562d.html"
  "tc41|97a4e1|4.1.2|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/97a4e1/ffe1796f06e1082a8ddae54a471dcca66c783c4e.html"
  "tc42|6cfa84|4.1.2|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/6cfa84/5bd22090d0f74dcea752749ef4ad8411e3772535.html"
  "tc43|6cfa84|4.1.2|passed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/6cfa84/9f9f5e323450f4c0bd5445597a39d160ce07ff48.html"
  "tc44|6cfa84|4.1.2|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/6cfa84/4e7955d592cbf361a55113fcd4524e979b16bb08.html"
  "tc45|6cfa84|4.1.2|failed|https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/6cfa84/2adaacc2f7b8d7a0d2d1496ad6f56aafd171f7fe.html"
)

echo "Running evaluation on ${#CASES[@]} test cases..."

for entry in "${CASES[@]}"; do
  IFS='|' read -r id ruleId wcag expected url <<< "$entry"
  echo "[$id] rule=$ruleId wcag=$wcag expected=$expected"

  # Navigate to test case
  run_sprite bun orca-driver.ts navigate "$url" > /dev/null 2>&1 || true
  sleep 1

  # Run axe-core audit
  AUDIT=$(run_sprite bun audit.ts --port 7484 --no-tree 2>&1) || AUDIT='{"error":"audit failed"}'
  echo "$AUDIT" > "$RESULTS_DIR/${id}_audit.json"

  # Get Orca transcript
  TRANSCRIPT=$(run_sprite bun orca-driver.ts transcript --clear 2>&1) || TRANSCRIPT="(no transcript)"
  echo "$TRANSCRIPT" > "$RESULTS_DIR/${id}_orca.txt"

  # Quick Orca navigation check (next a few times)
  for i in 1 2 3; do
    ITEM=$(run_sprite bun orca-driver.ts next 2>&1) || true
    echo "  orca[$i]: $ITEM"
  done

  echo "  audit saved, transcript saved"
  echo "---"
done

echo "All results saved to $RESULTS_DIR/"
