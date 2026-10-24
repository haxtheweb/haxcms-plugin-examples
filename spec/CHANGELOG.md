# Spec changelog

Every change to the specification, schema or hook list is recorded here with an **upgrade recipe** and a **fixture**. This is what lets an agent bring an existing plugin forward and prove the result against the conformance suite.

Entry format:

```
## <spec version>
- Change: what changed and why
- Upgrade recipe: exact, mechanical steps for a plugin author or agent
- Fixture: path under tests/fixtures/ that fails before and passes after
```

## 0.1.0 (draft)
- Initial draft. No upgrade recipes needed yet.
