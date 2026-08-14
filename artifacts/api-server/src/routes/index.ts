import { Router, type IRouter } from "express";
import healthRouter from "./health";
import entregasRouter from "./entregas";
import motoristasRouter from "./motoristas";
import motivosCancelamentoRouter from "./motivos-cancelamento";

const router: IRouter = Router();

router.use(healthRouter);
router.use(entregasRouter);
router.use(motoristasRouter);
router.use(motivosCancelamentoRouter);

export default router;
