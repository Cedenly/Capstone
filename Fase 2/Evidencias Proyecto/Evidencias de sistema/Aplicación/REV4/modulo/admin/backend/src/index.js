import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { authRequired } from './middleware/auth.js';
import { notFound, errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import metricsRoutes from './routes/metrics.js';
import sponsorsRoutes from './routes/sponsors.js';
import opsRoutes from './routes/ops.js';
import usersRoutes from './routes/users.js';
import ticketsRoutes from './routes/tickets.js';
import correctionsRoutes from './routes/corrections.js';
import questionsRoutes from './routes/questions.js';
import plansRoutes from './routes/plans.js';
import tutorsRoutes from './routes/tutors.js';
import billingRoutes from './routes/billing.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Healthcheck
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'aprueba-admin-api' }));

// Rutas públicas de auth de la consola: /api/v1/admin/auth/*
app.use('/api/v1/admin', authRoutes);

// A partir de aquí, todo /admin exige token administrativo.
const admin = express.Router();
admin.use(authRequired);
admin.use(billingRoutes);
admin.use(metricsRoutes);
admin.use(sponsorsRoutes);
admin.use(opsRoutes);
admin.use(usersRoutes);
admin.use(ticketsRoutes);
admin.use(correctionsRoutes);
admin.use(questionsRoutes);
admin.use(plansRoutes);
admin.use(tutorsRoutes);
app.use('/api/v1/admin', admin);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`[aprueba-admin-api] escuchando en http://localhost:${PORT}/api/v1`));

export default app;
