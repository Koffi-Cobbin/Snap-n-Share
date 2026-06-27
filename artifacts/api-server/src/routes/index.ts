import { Router, type IRouter } from "express";
import healthRouter from "./health";
import eventsRouter from "./events";
import photosRouter from "./photos";
import storageRouter from "./storage";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(eventsRouter);
router.use(photosRouter);
router.use(storageRouter);
router.use(adminRouter);

export default router;
