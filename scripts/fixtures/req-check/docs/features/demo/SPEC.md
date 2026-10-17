---
title: Demo
code: DEMO
status: In Progress
---

# Demo

## Requirements

### DEMO-1 Tags and ticks

Prose under a requirement isn't a criterion, even when it mentions DEMO-1.1.

- [x] DEMO-1.1 Ticked and tested. (test)
- [x] DEMO-1.2 Ticked, with no test. (test)
- [x] DEMO-1.3 Ticked, with a Behaviour test. (e2e)
- [x] DEMO-1.4 Ticked, with only a unit test. (e2e)
- [x] DEMO-1.5 Looked at, and tested anyway. (manual)
- [ ] DEMO-1.6 Open, already tested. (test)
- [ ] DEMO-1.7 Open, not tested yet. (test)
- [ ] DEMO-1.8 Open, no Behaviour test yet. (e2e)
- [x] ~~DEMO-1.9 Dropped.~~ (test)

### DEMO-2 Spanning lines

- [x] DEMO-2.1 Holds for:
  - one (a nested item's (manual) isn't its tag);
  - two.

  Verified by a test. (test)
- [ ] DEMO-2.2 Open, with no tag yet.

### ~~DEMO-3 A dropped requirement~~

- [ ] ~~DEMO-3.1 Dropped with it.~~ (test)

### DEMO-4 Fenced examples

~~~
- [x] DEMO-4.9 A fenced checklist line isn't a criterion. (test)
~~~

```markdown
## A fenced heading doesn't end the requirement
```

- [x] DEMO-4.1 Ticked after the fences. (test)
  ````
  Its fenced text isn't its tag: (manual)
  ```
  ````
- [ ] DEMO-4.2 Open, after a fence inside a criterion. (test)

## Open questions

- [ ] Does an open question that mentions DEMO-1.1 count? No: it doesn't start with an id. (test)
