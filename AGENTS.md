- Only create an abstraction if it's actually needed
- Prefer clear function/variable names over inline comments
- Avoid helper functions when a simple inline expression would suffice
- Don't use emojis
- Bun is the default package manager
- Use `bun typecheck` to run typescript

## React

- Avoid massive JSX blocks and compose smaller components
- Colocate code that changes together
- Avoid `useEffect` unless absolutely needed

## Tailwind

- Mostly use built-in values, occasionally allow dynamic values, rarely globals
- Always use v4 + global CSS file format + shadcn/ui
- Use the components in src/components/ui as building blocks

## TypeScript

- Don't unnecessarily add `try`/`catch`
- Don't cast to `any`
