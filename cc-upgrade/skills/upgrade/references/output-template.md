# Upgrade Report Output Template

Use this format when generating the final upgrade report.

```markdown
# Upgrade Report
**Generated:** [timestamp]
**Sources Processed:** [N] sources checked | [N] updates found

---

## Discoveries

Everything interesting found, ranked by how compelling it is.

| # | Discovery | Source | Why Interesting | Relevance |
|---|-----------|--------|-----------------|-----------|
| 1 | [Name] | [GitHub release / Blog / Docs] | [1-2 sentences] | [How it maps to user's setup] |

---

## Recommendations

### CRITICAL — Integrate immediately

| # | Recommendation | Relevance | Effort | Files Affected |
|---|---------------|-----------|--------|----------------|
| 1 | [Short action name] | [Why this matters — what gap it fills] | Low/Med/High | `[file1]`, `[file2]` |

### HIGH — Integrate this week
### MEDIUM — When convenient
### LOW — Awareness

---

## Technique Details

### [N]. [Feature/Change Name]
**Source:** [exact source with version/timestamp/commit]
**What It Is (16-32 words):** [Describe the technique — what it does, how it works]
**How It Helps (16-32 words):** [Specific benefit — which component improves, what gap it fills]

**The Technique:**
> [exact code pattern, configuration, or approach — quoted or code-blocked]

**Implementation:**
```typescript
// Before (current pattern)
[current code]

// After (with this technique)
[new code]
```

---

## Summary

| # | Technique | Source | Priority | Component | Effort |
|---|-----------|--------|----------|-----------|--------|
| 1 | [name] | [source] | HIGH/MED/LOW | [component] | Low/Med/High |

**Totals:** [N] Critical | [N] High | [N] Medium | [N] Low | [N] Skipped

---

## Skipped Content

| Content | Source | Why Skipped |
|---------|--------|-------------|
| [title] | [source] | [No extractable technique / Not relevant / Already implemented] |
```

## Word Count Rules

- **What It Is**: 16-32 words, concrete and specific
- **How It Helps**: 16-32 words, names specific component or gap
- Count words — if under 16, add specificity; if over 32, condense
