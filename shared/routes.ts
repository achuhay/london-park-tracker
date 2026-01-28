import { z } from 'zod';
import { insertParkSchema, parks } from './schema';

// ============================================
// SHARED ERROR SCHEMAS
// ============================================
export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

// ============================================
// API CONTRACT
// ============================================
export const api = {
  parks: {
    list: {
      method: 'GET' as const,
      path: '/api/parks',
      input: z.object({
        borough: z.string().optional(),
        siteType: z.string().optional(),
        openToPublic: z.string().optional(),
        search: z.string().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof parks.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/parks/:id',
      responses: {
        200: z.custom<typeof parks.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/parks',
      input: insertParkSchema,
      responses: {
        201: z.custom<typeof parks.$inferSelect>(),
        400: errorSchemas.validation,
        401: z.object({ message: z.string() }), // Unauthorized
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/parks/:id',
      input: insertParkSchema.partial().extend({
        completed: z.boolean().optional(),
        completedDate: z.string().optional().or(z.date().optional()),
      }),
      responses: {
        200: z.custom<typeof parks.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
        401: z.object({ message: z.string() }), // Unauthorized
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/parks/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
        401: z.object({ message: z.string() }), // Unauthorized
      },
    },
    toggleComplete: {
      method: 'PATCH' as const,
      path: '/api/parks/:id/complete',
      input: z.object({ completed: z.boolean() }),
      responses: {
        200: z.custom<typeof parks.$inferSelect>(),
        404: errorSchemas.notFound,
        401: z.object({ message: z.string() }), // Unauthorized
      },
    },
    stats: {
      method: 'GET' as const,
      path: '/api/stats',
      responses: {
        200: z.object({
          total: z.number(),
          completed: z.number(),
          percentage: z.number(),
          byBorough: z.record(z.object({ total: z.number(), completed: z.number() })),
        }),
      },
    },
    filterOptions: {
      method: 'GET' as const,
      path: '/api/parks/filter-options',
      responses: {
        200: z.object({
          boroughs: z.array(z.string()),
          siteTypes: z.array(z.string()),
          openToPublicOptions: z.array(z.string()),
        }),
      },
    }
  },
};

// ============================================
// REQUIRED: buildUrl helper
// ============================================
export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

// ============================================
// TYPE HELPERS
// ============================================
export type ParkInput = z.infer<typeof api.parks.create.input>;
export type ParkResponse = z.infer<typeof api.parks.create.responses[201]>;
export type ParkUpdateInput = z.infer<typeof api.parks.update.input>;
export type ParksListResponse = z.infer<typeof api.parks.list.responses[200]>;
export type ParkStatsResponse = z.infer<typeof api.parks.stats.responses[200]>;
