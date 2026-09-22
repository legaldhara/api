import { Request, Response } from "express";
import { prisma } from "../config/db";
import { decryptRSA, encryptRSA } from "../config/encryption";
import { firebaseAdmin, verifyFirebaseToken } from "../config/firebase";
import { formatToIndianNumber } from "../utils/lib";
import JWT from 'jsonwebtoken'
import { AuthPayload, AuthRequest } from "../types/custom";
import MailService from "../services/Mail";
import { Role, TokenType } from "@prisma/client";
import { userRegisterSchema, updateUserProfileSchema, userLoginByEmailAndPasswordSchema } from "../zodSchema/user.schema";
import { hash, compare } from "bcryptjs";
import { logger } from "../utils/logger";
import { getWelcomeEmail } from "../utils/email";


const isProduction = process.env.NODE_ENV === "production";

// -- Admin Specifice Routes
//Create Admin Seed
export const createAdminFromFirebaseUser: any = async () => {
  try {
    const user = {
      phoneNumber: '+919424440004',
      email: 'test123@gmail.com',
      displayName: 'Ayush Shrivastav',
    };


    const existingAccount = await prisma.user.findFirst({
      where: { phone: user.phoneNumber, email: user.email },
    });

    if (existingAccount) {
      return existingAccount;
    }

    // Step 3: Create new Account and Admin
    const newAccount = await prisma.user.create({
      data: {
        fullName: user.displayName,
        email: user.email,
        phone: user.phoneNumber,
        role: "ADMIN",
        gender: 'Male',
        city: 'Indore',
        isActive: true,
        termsAccepted: true,
        termsAcceptedAt: new Date(),
        emailVerified: false,
        lastLogin: new Date(),
      },
    });

    console.log("Admin account created:", newAccount);
    return newAccount;

  } catch (error: any) {
    console.error("Error in createAdminFromFirebaseUser:", error);
    throw new Error(`Failed to create admin: ${error.message}`);
  }
};

//LocalHost Testing
export const localhost = async (req: Request, res: Response): Promise<Response | void> => {
  const phoneNumber = req.body.phone;
  const phone = formatToIndianNumber(phoneNumber);

  try {
    if (isProduction) {
      // ✅ Special case: test distributor number → issue token directly
      if (phone === "+919876543211" || phone === "+919876543210") {
        const account = await prisma.user.findFirst({
          where: { phone },
        });

        if (!account) {
          return res.status(404).json({ success: false, message: "User not found! Please register." });
        }

        const jwtPayload = {
          id: account.id,
          sub: account.uid,
          phone: account.phone,
          email: account.email,
          name: account.fullName,
          role: account.role,
        };

        const payload = encryptRSA(jwtPayload);

        const token = JWT.sign(
          { data: payload },
          process.env.JWT_SECRET!,
          { algorithm: "HS256", expiresIn: "1d" }
        );

        return res.status(200).json({ success: true, token, phone });
      }

      // ✅ Normal flow for production → only check existence
      const exists = await prisma.user.findFirst({
        where: {
          phone,
          role: { in: [Role.ADMIN, Role.COADMIN, Role.USER] },
        },
        select: { id: true }, // fetch minimum
      });

      if (!exists) {
        return res.status(403).json({ success: false, message: "User not exist" });
      }

      return res.status(200).json({ success: true });
    }

    // ✅ Local/dev → fetch details + issue JWT
    const account = await prisma.user.findFirst({
      where: {
        phone,
        role: { in: [Role.ADMIN, Role.COADMIN, Role.USER] },
      }
    });

    if (!account) {
      return res.status(404).json({ success: false, message: "User not exist" });
    }

    const jwtPayload = {
      id: account.id,
      sub: account.uid,
      phone: account.phone,
      email: account.email,
      name: account.fullName,
      role: account.role,
    };

    const payload = encryptRSA(jwtPayload);

    const token = JWT.sign(
      { data: payload },
      process.env.JWT_SECRET!,
      { algorithm: "HS256", expiresIn: "1d" }
    );

    return res.status(200).json({ success: true, token, phone });
  } catch (error: any) {
    logger.error("checkExistingAdminUser error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }

}

// Admin Related
export const loginAdminByPhone = async (req: Request, res: Response): Promise<Response | void> => {

  const authHeader = req.headers.authorization;
  const reqToken = authHeader?.split(' ')[1];

  if (!reqToken) {
    return res.status(401).json({ success: false, message: 'Unauthorized: No token provided' });
  }

  const phoneNumber = req.body.phone;
  const phone = formatToIndianNumber(phoneNumber);

  let uid: string | undefined;

  try {
    if (isProduction) {
      // ✅ Special case: allow JWT for test distributor in production
      if (phone === "+919876543210") {
        try {
          const decoded: any = JWT.verify(reqToken, process.env.JWT_SECRET!);
          const decrypted = decryptRSA(decoded.data);
          if (!decrypted || decrypted.phone !== phone) {
            return res.status(401).json({ success: false, error: "Invalid JWT token or phone mismatch" });
          }
          uid = decrypted.sub;
        } catch (jwtError) {
          return res.status(401).json({ success: false, error: "Invalid JWT token" });
        }
      } else {
        // Normal production flow → Firebase only
        try {
          const firebaseData = await verifyFirebaseToken(reqToken);
          uid = firebaseData.uid;
          if (firebaseData.phone !== phone) {
            return res.status(401).json({ success: false, error: "Phone mismatch in Firebase token" });
          }
        } catch (firebaseError) {
          return res.status(401).json({ success: false, error: "Invalid Firebase token" });
        }
      }
    } else {
      try {
        const decoded: any = JWT.verify(reqToken, process.env.JWT_SECRET!);
        const decrypted = decryptRSA(decoded.data);
        if (!decrypted || decrypted.phone !== phone) {
          return res.status(401).json({ success: false, error: "Invalid JWT token or phone mismatch" });
        }
        uid = decrypted.sub;
      } catch (jwtError) {
        return res.status(401).json({ success: false, error: "Invalid token" });
      }
    }

    const user = await prisma.user.findFirst({
      where: {
        phone,
        role: { in: [Role.ADMIN, Role.COADMIN] }, // GlobalRole enum
      }
    });

    if (!user) {
      return res.status(403).json({ success: false, message: "Unauthorized Access" });
    }

    // Step 3: Create JWT with user + distributor info
    const jwtPayload = {
      id: user.id,
      sub: user.uid,
      phone: user.phone,
      email: user.email,
      name: user.fullName,
      role: user.role,
    };

    const payload = encryptRSA(jwtPayload);

    const token = JWT.sign({ data: payload }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '1d' });
    const refreshToken = JWT.sign({ data: payload }, process.env.JWT_REFRESH_SECRET!, { algorithm: 'HS256', expiresIn: '7d' });

    // Step 4: Upsert Token
    await prisma.token.upsert({
      where: {
        token: refreshToken,
      },
      update: {},
      create: {
        userId: user.id,
        token: refreshToken,
        role: user.role,
        type: TokenType.REFRESH, // Make sure this matches your TokenType enum
        expiredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // Optional: Update last login
    const tx: any[] = [
      prisma.user.update({
        where: { id: user.id },
        data: {
          lastLogin: new Date(),
          loginAttempts: {
            increment: 1
          },
        },
      }),
    ];

    await prisma.$transaction(tx);

    // Step 5: Set cookies
    res.cookie("idToken", token, {
      // domain: 'www.example.in',
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.cookie("refreshToken", refreshToken, {
      // domain: 'www.example.in',
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const data = {
      name: user.fullName,
      phone: user.phone,
      email: user.email,
      role: user.role,
    };

    return res.status(200).json({
      success: true,
      message: "User login successful.",
      user: data,
    });



  } catch (err: any) {
    return res.status(401).json({ error: err.message });
  }
};


export const loginUserByEmailAndPassword = async (req: Request, res: Response) => {
  try {

    const parseResult = userLoginByEmailAndPasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, message: 'Validation Error', error: parseResult.error.format() });
    }

    const { email, password } = parseResult.data;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and Password are required' });
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'No Such User Exist' });
    }

    // Ensure password is set on account and compare
    if (!user.password) {
      return res.status(401).json({ success: false, message: 'Set password first' });
    }

    const isMatch = await compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect Password' });
    }

    // Step 3: Create JWT with user + distributor info
    const jwtPayload = {
      id: user.id,
      sub: user.uid,
      phone: user.phone,
      email: user.email,
      name: user.fullName,
      role: user.role,
    };

    const payload = encryptRSA(jwtPayload);

    const token = JWT.sign({ data: payload }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '1d' });
    const refreshToken = JWT.sign({ data: payload }, process.env.JWT_REFRESH_SECRET!, { algorithm: 'HS256', expiresIn: '7d' });

    // Step 4: Upsert Token
    await prisma.token.upsert({
      where: {
        token: refreshToken,
      },
      update: {},
      create: {
        userId: user.id,
        token: refreshToken,
        role: user.role,
        type: TokenType.REFRESH, // Make sure this matches your TokenType enum
        expiredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // Optional: Update last login
    const tx: any[] = [
      prisma.user.update({
        where: { id: user.id },
        data: {
          isActive: user.isActive ? undefined : true,
          lastLogin: new Date(),
          loginAttempts: {
            increment: 1
          },
        },
      }),
    ];

    await prisma.$transaction(tx);

    // Step 5: Set cookies
    res.cookie("idToken", token, {
      // domain: 'www.example.in',
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.cookie("refreshToken", refreshToken, {
      // domain: 'www.example.in',
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const data = {
      name: user.fullName,
      phone: user.phone,
      email: user.email,
      role: user.role,
    };

    return res.status(200).json({
      success: true,
      message: "User login successful.",
      user: data,
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// User Related 
export const loginUserByPhone = async (req: Request, res: Response): Promise<Response | void> => {
  const authHeader = req.headers.authorization;
  const reqToken = authHeader?.split(' ')[1];

  if (!reqToken) {
    return res.status(401).json({ success: false, message: 'Unauthorized: No token provided' });
  }

  const phoneNumber = req.body.phone;
  const phone = formatToIndianNumber(phoneNumber);

  let uid: string | undefined;

  try {
    if (isProduction) {
      // ✅ Special case: allow JWT for test distributor in production
      if (phone === "+919876543211") {
        try {
          const decoded: any = JWT.verify(reqToken, process.env.JWT_SECRET!);
          const decrypted = decryptRSA(decoded.data);
          if (!decrypted || decrypted.phone !== phone) {
            return res.status(401).json({ success: false, error: "Invalid JWT token or phone mismatch" });
          }
          uid = decrypted.sub;
        } catch (jwtError) {
          return res.status(401).json({ success: false, error: "Invalid JWT token" });
        }
      } else {
        // Normal production flow → Firebase only
        try {
          const firebaseData = await verifyFirebaseToken(reqToken);
          uid = firebaseData.uid;
          if (firebaseData.phone !== phone) {
            return res.status(401).json({ success: false, error: "Phone mismatch in Firebase token" });
          }
        } catch (firebaseError) {
          return res.status(401).json({ success: false, error: "Invalid Firebase token" });
        }
      }
    } else {
      try {
        const decoded: any = JWT.verify(reqToken, process.env.JWT_SECRET!);
        const decrypted = decryptRSA(decoded.data);
        if (!decrypted || decrypted.phone !== phone) {
          return res.status(401).json({ success: false, error: "Invalid JWT token or phone mismatch" });
        }
        uid = decrypted.sub;
      } catch (jwtError) {
        return res.status(401).json({ success: false, error: "Invalid token" });
      }
    }

    const user = await prisma.user.findFirst({
      where: {
        phone,
        role: 'USER', // GlobalRole enum
      }
    });

    if (!user) {
      return res.status(200).json({ success: false, message: "No user found" });
    }

    // Step 3: Create JWT with user + distributor info
    const jwtPayload = {
      domain: 'www.example.in',
      id: user.id,
      sub: user.uid,
      phone: user.phone,
      email: user.email,
      name: user.fullName,
      role: user.role,
    };

    const payload = encryptRSA(jwtPayload);

    const token = JWT.sign({ data: payload }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '1d' });
    const refreshToken = JWT.sign({ data: payload }, process.env.JWT_REFRESH_SECRET!, { algorithm: 'HS256', expiresIn: '7d' });

    // Step 4: Upsert Token
    await prisma.token.upsert({
      where: {
        token: refreshToken,
      },
      update: {},
      create: {
        userId: user.id,
        token: refreshToken,
        role: user.role,
        type: TokenType.REFRESH, // Make sure this matches your TokenType enum
        expiredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // Optional: Update last login
    const tx: any[] = [
      prisma.user.update({
        where: { id: user.id },
        data: {
          lastLogin: new Date(),
          loginAttempts: {
            increment: 1
          },
        },
      }),
    ];

    await prisma.$transaction(tx);

    // Step 5: Set cookies
    res.cookie("idToken", token, {
      // domain: 'www.example.in',
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.cookie("refreshToken", refreshToken, {
      // domain: 'www.example.in',
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const data = {
      name: user.fullName,
      phone: user.phone,
      email: user.email,
      role: user.role,
    };

    return res.status(200).json({
      success: true,
      message: "User login successful.",
      user: data,
    });



  } catch (err: any) {
    return res.status(401).json({ error: err.message });
  }
};

// Validate Session
export const authSession = async (req: Request, res: Response): Promise<Response | void> => {
  const user = (req as AuthRequest)?.auth;

  if (!user || !user.id || !user.role) {
    return res.status(401).json({
      success: false,
      error: "Invalid session or token payload",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Verified",
    user: {
      email: user.email,
      phone: user.phone,
      role: user.role,
      name: user.name
    },
  });
};

// Logging Out
export const logout = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    // Step 1: Clear cookies
    res.clearCookie("idToken", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
    });

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
    });

    // Step 2: Get userId or any identifier from the authenticated user (e.g., from the JWT token)
    const userId = (req as AuthRequest)?.auth?.id;

    if (!userId) {
      return res.status(400).json({ message: "Account ID not found." });
    }

    // Step 3: If no refresh token is present in the cookies, delete the refresh token based on userId
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      // Delete refresh token from the database using userId
      await prisma.token.deleteMany({
        where: {
          userId: userId, // Use userId to identify the token to delete
        },
      });
    } else {
      // If refresh token is present in the cookies, delete the token using its value
      await prisma.token.deleteMany({
        where: {
          token: refreshToken,
        },
      });
    }

    return res.status(200).json({ message: "Logged out successfully." });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};

//Refresh Session
export const refreshSession = async (req: Request, res: Response): Promise<Response | void> => {
  const oldRefreshToken = req.cookies?.refreshToken;

  if (!oldRefreshToken) {
    return res.status(401).json({ success: false, error: "Refresh token missing" });
  }

  try {
    // Step 1: Verify old refresh token
    const decoded = JWT.verify(oldRefreshToken, process.env.JWT_REFRESH_SECRET!) as { data: string };
    if (!decoded?.data) {
      return res.status(401).json({ success: false, error: "Invalid token payload" });
    }

    const payload = decryptRSA(decoded.data) as AuthPayload;

    // Step 2: Find token in DB
    const existingToken = await prisma.token.findUnique({
      where: { token: oldRefreshToken },
      include: { user: true },
    });


    if (!existingToken || new Date(existingToken.expiredAt) < new Date()) {
      return res.status(401).json({ success: false, error: "Refresh token is invalid or expired" });
    }

    if (payload.id !== existingToken?.userId) {
      return res.status(401).json({ success: false, error: "Token account mismatch" });
    }
    // Step 3: Rotate tokens – generate new access and refresh tokens
    const jwtPayload = {
      domain: 'www.nexashopping.in',
      id: existingToken.userId,
      sub: existingToken.user.uid,
      phone: existingToken.user.phone,
      email: existingToken.user.email,
      name: existingToken.user.fullName,
      role: existingToken.role,
    };

    const encryptedPayload = encryptRSA(jwtPayload);

    const newIdToken = JWT.sign({ data: encryptedPayload }, process.env.JWT_SECRET!, {
      algorithm: 'HS256',
      expiresIn: '1d',
    });

    const newRefreshToken = JWT.sign({ data: encryptedPayload }, process.env.JWT_REFRESH_SECRET!, {
      algorithm: 'HS256',
      expiresIn: '7d',
    });

    const expiredAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Step 4: Transaction to delete old token and insert new one
    await prisma.$transaction([
      prisma.token.delete({
        where: { token: oldRefreshToken },
      }),
      prisma.token.create({
        data: {
          userId: existingToken.userId,
          token: newRefreshToken,
          role: existingToken.role,
          type: "REFRESH",
          expiredAt,
        },
      }),
    ]);

    // Step 5: Set cookies
    res.cookie("idToken", newIdToken, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Step 6: Return response
    return res.status(200).json({
      success: true,
      message: "Session refreshed successfully",
      user: {
        name: existingToken.user.fullName,
        phone: existingToken.user.phone,
        email: existingToken.user.email,
        role: existingToken.role,
      },
    });

  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, error: "Refresh token expired. Please login again." });
    }
    console.error("Refresh session error:", err.message);
    return res.status(401).json({ success: false, error: "Invalid or corrupted refresh token" });
  }
};



export const userRegister = async (req: Request, res: Response): Promise<Response> => {
  try {
    const parseResult = userRegisterSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: "Validation Error",
        errors: parseResult.error.format(), // <-- detailed field-level errors
      });
    }

    const phone = parseResult.data?.phone;
    const formattedPhone = formatToIndianNumber(phone);

    const { fullName, email, city, gender, dob, password, confirmPassword } = parseResult.data;

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Password and Confirm Password do not match",
      });
    }

    // Check if user exists by email OR phone
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { phone }],
      },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User already registered with this email or phone",
      });
    }

    // Hash password
    const hashedPassword = password ? await hash(password, 10) : null;

    const newUser = await prisma.user.create({
      data: {
        fullName,
        email,
        phone: formattedPhone,
        city,
        gender,
        dob: dob ? new Date(dob) : null,
        password: hashedPassword,
        termsAccepted: true,
        termsAcceptedAt: new Date(),
        lastLogin: null,
        isActive: false,
        emailVerified: false,
        role: Role.USER,
      },
    });


    if (isProduction && newUser.email) {
      const welcomeEmail = getWelcomeEmail(newUser.fullName);

      await MailService.send(
        newUser.email,
        welcomeEmail.subject,
        welcomeEmail.text,
        "info",
        welcomeEmail.html
      ).catch(console.log);
    }

    return res.status(201).json({
      success: true,
      message: "Registered Successfully",
      user: {
        name: newUser.fullName,
        phone: newUser.phone,
        email: newUser.email,
        role: newUser.role,
      },
    });


  } catch (err: any) {
    console.error("Registration Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};


export const registerCoadmin = async (
  req: Request,
  res: Response
): Promise<Response | void> => {
  const parseResult = userRegisterSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      success: false,
      message: "Validation Error",
    });
  }

  const { fullName, email, phone, city } = parseResult.data;

  try {
    let userRecord;
    try {
      userRecord = await firebaseAdmin.auth().createUser({
        email,
        phoneNumber: phone,
        displayName: fullName,
      });
    } catch (err: any) {
      if (err.code === "auth/phone-number-already-exists") {
        userRecord = await firebaseAdmin.auth().getUserByPhoneNumber(phone);
      } else if (err.code === "auth/email-already-exists") {
        userRecord = await firebaseAdmin.auth().getUserByEmail(email);
      } else {
        throw new Error(`Firebase user creation failed: ${err.message}`);
      }
    }

    const uid = userRecord.uid;

    const existingUser = await prisma.user.findUnique({ where: { uid } });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User already registered",
      });
    }

    const newUser = await prisma.user.create({
      data: {
        uid,
        fullName,
        email,
        phone,
        city,
        isActive: true,
        termsAccepted: true,
        termsAcceptedAt: new Date(),
        lastLogin: new Date(),
        emailVerified: userRecord.emailVerified ?? false,
        role: Role.COADMIN,
      },
    });

    const jwtPayload = {
      id: newUser.id,
      sub: newUser.uid,
      phone: newUser.phone,
      email: newUser.email,
      name: newUser.fullName,
      role: newUser.role,
    };

    const encryptedPayload = encryptRSA(jwtPayload);

    const token = JWT.sign(
      { data: encryptedPayload },
      process.env.JWT_SECRET!,
      {
        algorithm: "HS256",
        expiresIn: "1d",
      }
    );

    const refreshToken = JWT.sign(
      { data: encryptedPayload },
      process.env.JWT_REFRESH_SECRET!,
      {
        algorithm: "HS256",
        expiresIn: "7d",
      }
    );

    await prisma.token.create({
      data: {
        userId: newUser.id,
        token: refreshToken,
        role: newUser.role,
        type: "REFRESH",
        expiredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    res.cookie("idToken", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    await MailService.send(
      newUser.email,
      "Welcome to Nexa (COADMIN)",
      `<p>Hi <strong>${newUser.fullName}</strong>,</p><p>Your co-admin account has been created successfully on <strong>Nexa</strong>.</p>`
    );

    return res.status(201).json({
      success: true,
      message: "Coadmin registered successfully",
      user: {
        name: newUser.fullName,
        phone: newUser.phone,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (err: any) {
    console.error("Coadmin Registration Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};


// export const getUserProfile = async (
//   req: Request,
//   res: Response
// ): Promise<Response | void> => {
//   const user = (req as AuthRequest)?.auth;

//   if (!user || !user.id) {
//     return res.status(401).json({
//       success: false,
//       message: "Unauthorized: User not found in request context",
//     });
//   }

//   try {
//     const profile = await prisma.user.findUnique({
//       where: { id: user.id },
//       select: {
//         fullName: true,
//         email: true,
//         phone: true,
//         dob: true,
//         gender: true,
//         role: true,
//         emailVerified: true,
//       },
//     });

//     if (!profile) {
//       return res
//         .status(404)
//         .json({ success: false, message: "User not found" });
//     }

//     return res.status(200).json({ success: true, user: profile });
//   } catch (err: any) {
//     return res.status(500).json({ success: false, error: err.message });
//   }
// };


// export const updateUserProfile = async (
//   req: Request,
//   res: Response
// ): Promise<Response | void> => {
//   const user = (req as AuthRequest).auth;

//   if (!user || !user.id) {
//     return res.status(401).json({
//       success: false,
//       message: "Unauthorized: User not found in request context",
//     });
//   }

//   const parsed = updateUserProfileSchema.safeParse(req.body);
//   if (!parsed.success) {
//     return res.status(400).json({
//       success: false,
//       message: "Validation failed",
//     });
//   }

//   const { fullName, phone, dob, gender, city } = parsed.data;

//   try {
//     const existingUser = await prisma.user.findUnique({
//       where: { id: user.id },
//     });

//     if (!existingUser) {
//       return res.status(404).json({
//         success: false,
//         message: "User not found",
//       });
//     }

//     const updatedUser = await prisma.user.update({
//       where: { id: user.id },
//       data: {
//         fullName: fullName ?? existingUser.fullName,
//         phone: phone ?? existingUser.phone,
//         dob: dob ? new Date(dob) : existingUser.dob,
//         gender: gender ?? existingUser.gender,
//         city: city ?? existingUser.city,
//         updatedAt: new Date(),
//       },
//       select: {
//         fullName: true,
//         email: true,
//         phone: true,
//         dob: true,
//         gender: true,
//         city: true,
//         role: true,
//       },
//     });

//     return res.status(200).json({
//       success: true,
//       message: "User profile updated successfully",
//       user: updatedUser,
//     });
//   } catch (err: any) {
//     console.error("Update error:", err.message);
//     return res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: err.message,
//     });
//   }
// };


// / Change or set password
export const updateUserPassword = async (req: Request, res: Response) => {
  try {
    const { phone, oldPassword, newPassword } = req.body;

    if (!phone || !newPassword) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    const user = await prisma.user.findUnique({ where: { phone: formatToIndianNumber(phone) } });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // If oldPassword provided → user is changing password after login
    // if (oldPassword) {
    //   if (!user.password) {
    //     return res.status(400).json({ success: false, message: "No existing password found" });
    //   }

    //   const isMatch = await compare(oldPassword, user.password);
    //   if (!isMatch) {
    //     return res.status(400).json({ success: false, message: "Incorrect old password" });
    //   }
    // }

    const hashedPassword = newPassword ? await hash(newPassword, 10) : null;

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, updatedAt: new Date() },
    });

    return res.status(200).json({
      success: true,
      message: oldPassword
        ? "Password changed successfully"
        : "Password set successfully",
    });
  } catch (error) {
    console.error("Password update error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};