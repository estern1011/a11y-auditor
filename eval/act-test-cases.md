# ACT Rules Test Cases

Collected from [W3C ACT Rules](https://www.w3.org/WAI/standards-guidelines/act/rules/) for evaluating our auditor's detection accuracy.

## Selected Rules

| # | Rule ID | Rule Name | WCAG SC | Criterion |
|---|---------|-----------|---------|-----------|
| 1 | 23a2a8 | Image has non-empty accessible name | 1.1.1 | Non-text Content |
| 2 | 59796f | Image button has non-empty accessible name | 1.1.1 | Non-text Content |
| 3 | e086e5 | Form field has non-empty accessible name | 1.3.1 | Info and Relationships |
| 4 | afw4f7 | Text has minimum contrast | 1.4.3 | Contrast (Minimum) |
| 5 | 047fe0 | Document has heading for non-repeated content | 2.4.1 | Bypass Blocks |
| 6 | c487ae | Link has non-empty accessible name | 2.4.4 | Link Purpose |
| 7 | 97a4e1 | Button has non-empty accessible name | 4.1.2 | Name, Role, Value |
| 8 | 6cfa84 | Element with aria-hidden has no focusable content | 4.1.2 | Name, Role, Value |

## Test Cases

### Rule 23a2a8 — Image has non-empty accessible name (WCAG 1.1.1)

| # | Test Case URL | Expected |
|---|---------------|----------|
| 1 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/32bfac8a98cc212aa7bf9151bf40f665a7f51696.html | passed |
| 2 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/38cc6a87fcc81fcc2248f0cd74ca48396b7aa432.html | passed |
| 3 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/feb06eece7b158ab66a25bfa2c47a196309f0d93.html | passed |
| 4 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/8006d1541dc71b93e6ec4d101a386e0043d1a521.html | failed |
| 5 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/496963cfd35d4873c010469c47c84d4358fba035.html | failed |
| 6 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/fef9a3ad8b2f2a6beeaf44ef7dafce08e743ea67.html | failed |

### Rule 59796f — Image button has non-empty accessible name (WCAG 1.1.1)

| # | Test Case URL | Expected |
|---|---------------|----------|
| 7 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/59796f/8c29bcb24ac0f448846a2ffdad4c9693d5aef8c6.html | passed |
| 8 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/59796f/b413c09531b239e27bcf79cb57302b429ef59fe6.html | passed |
| 9 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/59796f/04342a3834e0003f3057807937d617e432e83d33.html | failed |
| 10 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/59796f/5c71cdabc04f9038e21d872e20a516cb429a7619.html | failed |
| 11 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/59796f/0bbd55ba8e418361f99f717418206a37d57fd978.html | failed |

### Rule e086e5 — Form field has non-empty accessible name (WCAG 1.3.1)

| # | Test Case URL | Expected |
|---|---------------|----------|
| 12 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/e086e5/933cad4e69415e2a2970832d2d60e2b854bca1b4.html | passed |
| 13 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/e086e5/366e62d83ede9df9fdad86cf7040600916bb065a.html | passed |
| 14 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/e086e5/6726b79b0534d80f567c3e5fd7174962d411be95.html | passed |
| 15 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/e086e5/004258203c8bf167307b6ed79f765115d16a6357.html | failed |
| 16 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/e086e5/5c0ba53d53cc9fd8627f224b39db30bd9ffa5757.html | failed |
| 17 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/e086e5/80a5df2346e082cd0be260143ac9090a902bcf30.html | failed |

### Rule afw4f7 — Text has minimum contrast (WCAG 1.4.3)

| # | Test Case URL | Expected |
|---|---------------|----------|
| 18 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/afw4f7/fd406bedf0bb3bdc4c2a718f49a3dd0f7aaa7556.html | passed |
| 19 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/afw4f7/ab4691ef474d6263e9ceec824f07faa51a30112e.html | passed |
| 20 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/afw4f7/dc170fd015758b62d8e0141e086893a116ee724e.html | passed |
| 21 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/afw4f7/eaf0a926896f045a498073da42ea6263a4d6d36c.html | failed |
| 22 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/afw4f7/e8f3acb1dc814b8b815c69b7150cdea67d5bd98e.html | failed |
| 23 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/afw4f7/41afaa9b33287aba9c608c3466e2b164f57a02ed.html | failed |

### Rule 047fe0 — Document has heading for non-repeated content (WCAG 2.4.1)

| # | Test Case URL | Expected |
|---|---------------|----------|
| 24 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/047fe0/c67821f1bd796c8dcabd5fd32c647780fa324e27.html | passed |
| 25 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/047fe0/9b25d8065dc0ba59bf1c282efb27dcd81298fed4.html | passed |
| 26 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/047fe0/8e7af0a95841a94b2d1dbee0860b4719c2085945.html | passed |
| 27 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/047fe0/7505d097f7d59d71dc7eb8f7ab82c5682def54d4.html | failed |
| 28 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/047fe0/81d501e52085d9e5712e241bdd24708e7cb4a301.html | failed |
| 29 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/047fe0/929079705b1789667853e023b818eb4101630700.html | failed |

### Rule c487ae — Link has non-empty accessible name (WCAG 2.4.4)

| # | Test Case URL | Expected |
|---|---------------|----------|
| 30 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/c487ae/a8cc66de4d60e34c7ee0d09fd6ab965ac23d9b4f.html | passed |
| 31 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/c487ae/d761116217a5875490cd7a2adf0219bdb1bff5cf.html | passed |
| 32 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/c487ae/ada7438401aba500eb03f678b05b9821a758336a.html | passed |
| 33 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/c487ae/97b115a032fc4178230306e2d0f4e334b2cfe8a9.html | failed |
| 34 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/c487ae/633d9136ef3e040b7653b287651c65e4302fe417.html | failed |
| 35 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/c487ae/954326e5ba700d4616d924807f427002816e9fc3.html | failed |

### Rule 97a4e1 — Button has non-empty accessible name (WCAG 4.1.2)

| # | Test Case URL | Expected |
|---|---------------|----------|
| 36 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/97a4e1/a4cc71b0434f71f4ea0069c409f73e0207dfb403.html | passed |
| 37 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/97a4e1/d9adf41033a5b71a0730b6df8c1c7e01088e9022.html | passed |
| 38 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/97a4e1/3004e7b1a47b2e5a5c77b3eef36b50d495c9e4a1.html | passed |
| 39 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/97a4e1/1ec8deb0b18514b612774d3af39b5ad41f2a792b.html | failed |
| 40 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/97a4e1/2c5b0625e21b3503d1cd4c4daf53b15ae41c562d.html | failed |
| 41 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/97a4e1/ffe1796f06e1082a8ddae54a471dcca66c783c4e.html | failed |

### Rule 6cfa84 — Element with aria-hidden has no focusable content (WCAG 4.1.2)

| # | Test Case URL | Expected |
|---|---------------|----------|
| 42 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/6cfa84/5bd22090d0f74dcea752749ef4ad8411e3772535.html | passed |
| 43 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/6cfa84/9f9f5e323450f4c0bd5445597a39d160ce07ff48.html | passed |
| 44 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/6cfa84/4e7955d592cbf361a55113fcd4524e979b16bb08.html | failed |
| 45 | https://w3.org/WAI/content-assets/wcag-act-rules/testcases/6cfa84/2adaacc2f7b8d7a0d2d1496ad6f56aafd171f7fe.html | failed |

## Summary

- **Total test cases**: 45
- **Expected passed**: 23
- **Expected failed**: 22
- **Rules covered**: 8
- **WCAG criteria covered**: 6 (1.1.1, 1.3.1, 1.4.3, 2.4.1, 2.4.4, 4.1.2)
