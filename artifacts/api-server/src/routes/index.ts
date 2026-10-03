import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import depositsRouter from "./deposits";
import redeemCodesRouter from "./redeem-codes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(depositsRouter);
router.use(redeemCodesRouter);

export default router;
