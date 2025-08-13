This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started (Local Dev)

Run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

You can start editing the chat UI by modifying `app/page.tsx` or the reusable chat logic in `components/Chat.tsx` & `lib/chat.ts`.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Chat Development Notes

The frontend calls the backend (default `http://localhost:3001`) at `/v1/chat/completions` with `stream: true` and incrementally renders tokens.

Configure backend base URL with an env var:

```bash
echo "NEXT_PUBLIC_API_BASE=http://localhost:3001" > .env.local
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Run with Docker

1. (Optional) create `.env.local` or use build arg for API base (already defaults to backend service name inside compose):
	```bash
	cp .env.example .env.local
	```
2. From repo root build & start stack:
	```bash
	docker compose -f docker-compose.yml up --build
	```
3. Visit http://localhost:3000

The Docker build inlines `NEXT_PUBLIC_API_BASE` at build time (defaults to `http://backend:3001`). Override with:
```bash
docker compose build --build-arg NEXT_PUBLIC_API_BASE=http://localhost:3001 frontend
```

For production deployment outside compose, push the built image and set `NEXT_PUBLIC_API_BASE` during build.
