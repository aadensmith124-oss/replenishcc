import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import depositsRouter from "./deposits";
import redeemCodesRouter from "./redeem-codes";
import accountManagementRouter from "./account-management";
import announcementsRouter from "./announcements";
import leaderboardRouter from "./leaderboard";
import supportRouter from "./support";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(depositsRouter);
router.use(redeemCodesRouter);
router.use(accountManagementRouter);
router.use(announcementsRouter);
router.use(leaderboardRouter);
router.use(supportRouter);

export default router;
