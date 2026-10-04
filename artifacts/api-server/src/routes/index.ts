import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import depositsRouter from "./deposits";
import redeemCodesRouter from "./redeem-codes";
import accountManagementRouter from "./account-management";
import announcementsRouter from "./announcements";
import leaderboardRouter from "./leaderboard";
import supportRouter from "./support";
import licenseStoreRouter from "./license-store";
import giftCardStoreRouter from "./gift-card-store";
import adminUsersRouter from "./admin-users";
import adminDashboardRouter from "./admin-dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(depositsRouter);
router.use(redeemCodesRouter);
router.use(accountManagementRouter);
router.use(announcementsRouter);
router.use(leaderboardRouter);
router.use(supportRouter);
router.use(licenseStoreRouter);
router.use(giftCardStoreRouter);
router.use(adminUsersRouter);
router.use(adminDashboardRouter);

export default router;
