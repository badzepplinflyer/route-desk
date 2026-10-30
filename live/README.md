# Route Desk live tracking

Cloudflare Worker + Durable Object that holds the latest aircraft state per tablet code.
Deployed by `.github/workflows/deploy-live.yml` using the repository secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
