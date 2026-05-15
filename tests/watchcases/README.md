# Watchcase Fixtures

Each watchcase is a small baseline-plus-patch repository transition for the
`tld watch` representation pipeline.

```
tld watchcase review tests/watchcases/go
```

The review command copies `baseline/` into a temporary git repository, commits
it, records the baseline watch representation, applies `change.patch`, reruns
the real watch pipeline, and prints the resulting element, connector, and view
diffs.

Inside review, `p` applies `change.patch` to the fixture `baseline/` so you can
inspect or edit the patched source tree, and `v` reverts it. Reruns expect the
fixture baseline to be reverted.

Saved annotations live in `expected.yaml`. Each run also refreshes
`workspace.before.yaml` and `workspace.after.yaml` beside it so the reviewed
object diffs can be compared against the materialized workspace state before
and after the patch. Empty `expected.yaml` files are intentional for new
fixtures: the first review pass creates the ground truth.

```
tld watchcase run tests/watchcases/go
```

The run command treats `correct` objects as required, `incorrect` objects as
known failures that should disappear after a fix, and `unreviewed` objects as
work still needing human judgment.
