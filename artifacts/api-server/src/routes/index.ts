import { Router, type IRouter } from "express";
import healthRouter from "./health";
import entregasRouter from "./entregas";
import motoristasRouter from "./motoristas";
import motivosCancelamentoRouter from "./motivos-cancelamento";
import clientesCadastroRouter from "./clientes-cadastro";

const router: IRouter = Router();

router.use(healthRouter);
router.use(entregasRouter);
router.use(motoristasRouter);
router.use(motivosCancelamentoRouter);
router.use(clientesCadastroRouter);

export default router;
