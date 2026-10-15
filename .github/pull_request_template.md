## Problem and resulting behavior

Describe the problem, scope and resulting behavior. Link the related public issue if available.

## Validation

List checks actually run, results and any skips. Runtime behavior changes must include tests.
Use synthetic data and isolated workspaces.

## Compatibility and boundaries

Explain any Supplier contract impact. Preserve Host-owned policy, authorization, workspace isolation, validation, persistence, File Lifecycle and Run History.

## Review checklist

- [ ] The change is small and focused, with no unrelated formatting.
- [ ] No secrets, real user data, unsanitized logs or generated QA/temp artifacts are included.
- [ ] Public information checks pass for source, staged content and this description; validation and attribution remain accurate.
- [ ] Validators, contracts and tests were not weakened to make checks pass.
- [ ] Any runtime behavior change includes relevant tests, and contract compatibility is described.

## Change and validation

Describe the concrete behavior change and the checks actually performed. State any NOT VERIFIED acceptance separately.

## Project state impact

- [ ] Updated current project state
- [ ] No state update needed

If an ordinary monitored change needs no update, replace the applicable placeholder with a specific explanation of why capabilities, limits, verification and next steps stay accurate:

- tools: <specific reason for Tool/Retry/Launcher changes>
- provider: <specific reason for Provider/runtime changes>
- governance: <specific review reason for CI/state-checker/test changes and their effect on gate strength>

Critical Host/Supplier version boundaries, capability lists, artifacts and Contracts require a substantive change to their corresponding current entry in `docs/PUBLIC-STATE.md`, including actual values for changed versions; this explanation cannot waive that requirement or any fact/behavior check. Updating only history, dates, whitespace or unrelated current entries does not synchronize that boundary. CI/state-checker/test changes always require a concrete `governance` review explanation under the applicable checkbox; ordinary CI maintenance may select no state update needed. Reviewers judge explanation/description truth and the state-impact of unmonitored changes.

Current state describes the target code tree. Record branch/PR/CI workflow evidence here or under dated historical evidence, not as long-term pending instructions. After authorized merge, inspect main and its CI at Git/GitHub.
