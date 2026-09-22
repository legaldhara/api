import express from "express";
import { asyncHandler } from "../utils/lib";

import { authenticate } from "../middleware/authMiddleware";
import { authorize } from "../middleware/authorize";
import { getAllUsers, getUserById, updateUser } from "../controller/user.controller";

const userRouter = express.Router();

userRouter.use(authenticate);

userRouter.put("/update", asyncHandler(updateUser));

// userRouter.delete("/user/:id", asyncHandler(deleteUser));

userRouter.get("/details", asyncHandler(getUserById));

userRouter.use(authorize("ADMIN","COADMIN"));

userRouter.get("/detail/:id", asyncHandler(getUserById));
userRouter.get("/getallusers", asyncHandler(getAllUsers));

export default userRouter;
