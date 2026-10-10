import { Router, type IRouter } from "express";
import healthRouter from "./health";
import entregasRouter from "./entregas";
import motoristasRouter from "./motoristas";
import motivosCancelamentoRouter from "./motivos-cancelamento";
import clientesCadastroRouter from "./clientes-cadastro";
import faturamentoRouter from "./faturamento";
import lembretesRouter from "./lembretes";
import romaneioRouter from "./romaneio";
import agendamentoFotosRouter from "./agendamento-fotos";
import { db, entregasTable, motoristasTable, motivosCancelamentoTable, clientesCadastroTable, faturamentoDiarioTable, faturamentoMetaTable, lembretesTable } from "@workspace/db";

const router: IRouter = Router();

router.use(healthRouter);
router.use(entregasRouter);
router.use(motoristasRouter);
router.use(motivosCancelamentoRouter);
router.use(clientesCadastroRouter);
router.use(faturamentoRouter);
router.use(lembretesRouter);
router.use(romaneioRouter);
router.use(agendamentoFotosRouter);

router.get("/sync/snapshot", async (_req, res, next): Promise<void> => {
	try {
		const [entregas, motoristas, motivos, clientes, faturamentoDiario, faturamentoMeta, lembretes] = await Promise.all([
			db.select().from(entregasTable),
			db.select().from(motoristasTable),
			db.select().from(motivosCancelamentoTable),
			db.select().from(clientesCadastroTable),
			db.select().from(faturamentoDiarioTable),
			db.select().from(faturamentoMetaTable),
			db.select().from(lembretesTable),
		]);
		res.json({ version: 1, generatedAt: new Date().toISOString(), entregas, motoristas, motivos, clientes, faturamentoDiario, faturamentoMeta, lembretes });
	} catch (error) {
		next(error);
	}
});

router.get("/sync/entregas", async (_req, res, next): Promise<void> => {
	try {
		const entregas = await db.select().from(entregasTable);
		res.json({ version: 1, entregas });
	} catch (error) {
		next(error);
	}
});

export default router;
