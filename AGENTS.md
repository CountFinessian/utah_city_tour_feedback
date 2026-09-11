<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:user-custom-rules -->
# Deployment & Environment Rules
- **Do not deploy or push to remote/production (`git push`) unless the user explicitly asks for it.**
- Always keep changes strictly local so the user can test in their local dev environment first.
<!-- END:user-custom-rules -->
