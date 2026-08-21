import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/health')({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          status: 'healthy',
          service: 'india-stock-guru',
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.round(process.uptime()),
          node: process.version,
        })
      },
    },
  },
})
