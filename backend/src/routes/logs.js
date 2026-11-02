import { Router } from 'express';
import { addClientLogs } from '../client-logs.js';

// /api/logs: a rider's browser sends its new log lines here (js/log.js).
const router = Router();

router.post('/', (req, res) => {
  const kept = addClientLogs(req.user.id, req.body?.entries, req.get('user-agent') ?? null);
  res.json({ kept });
});

export default router;
