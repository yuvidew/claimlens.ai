# ClaimLens AI

ClaimLens AI is a web app for checking factual claims in YouTube videos with evidence from news, official sites, funding sources, research, and public data.

The product is not a lie detector. It extracts checkable claims from video transcripts, searches trusted sources with LangChain tools, and shows whether each claim is supported, mixed, contradicted, misleading, or not publicly verifiable.

## Plans

All project planning docs live in [plan/](./plan/):

- [Product Plan](./plan/product-plan.md)
- [AI Pipeline Plan](./plan/ai-pipeline-plan.md)
- [UI Plan](./plan/ui-plan.md)
- [Implementation Roadmap](./plan/implementation-roadmap.md)

## MVP Flow

```text
User pastes YouTube URL
	-> App fetches transcript/captions
	-> AI extracts factual claims
	-> LangChain search tools collect evidence
	-> AI evaluates each claim against sources
	-> Website shows verdicts, confidence, and resource links
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Future Environment Variables

The AI implementation will need:

```env
GOOGLE_API_KEY=
TAVILY_API_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```
