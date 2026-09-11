const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function sendJson(res, status, data) {
  res.status(status).json(data);
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

async function supabaseRequest(table, options = {}) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}`,
    {
      method: options.method || "GET",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: options.prefer || "return=representation",
        ...(options.headers || {})
      },
      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(options.body)
    }
  );

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      "Supabase request failed";

    throw new Error(message);
  }

  return data;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const derivedKey = await scrypt(
    password,
    salt,
    64
  );

  return `${salt}:${derivedKey.toString("hex")}`;
}

async function passwordMatches(password, storedPassword) {
  if (!storedPassword || !storedPassword.includes(":")) {
    return false;
  }

  const [salt, savedHash] =
    storedPassword.split(":");

  const derivedKey = await scrypt(
    password,
    salt,
    64
  );

  const savedBuffer =
    Buffer.from(savedHash, "hex");

  const inputBuffer =
    Buffer.from(
      derivedKey.toString("hex"),
      "hex"
    );

  if (savedBuffer.length !== inputBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    savedBuffer,
    inputBuffer
  );
}

async function getUserByEmail(email) {
  const users = await supabaseRequest(
    `users?email=eq.${encodeURIComponent(email)}&select=*`
  );

  return users?.[0] || null;
}

async function getAdminByEmail(email) {
  const user = await getUserByEmail(email);

  if (!user || user.role !== "Admin") {
    return null;
  }

  return user;
}

function safeUser(user) {
  const {
    password,
    ...withoutPassword
  } = user;

  return withoutPassword;
}

module.exports = async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return sendJson(res, 500, {
        error: "Supabase environment variables are missing."
      });
    }

    const url = new URL(
      req.url,
      `https://${req.headers.host || "localhost"}`
    );

    const pathname = url.pathname;

    // ----------------------------------------
    // LOGIN / REGISTER
    // ----------------------------------------

    if (
      req.method === "POST" &&
      pathname === "/api/auth/login"
    ) {
      const body = await readBody(req);

      const name =
        String(body.name || "").trim();

      const email =
        String(body.email || "")
          .trim()
          .toLowerCase();

      const password =
        String(body.password || "");

      const requestedRole =
        String(body.role || "Learner");

      if (
        !name ||
        !email ||
        password.length < 6
      ) {
        return sendJson(res, 400, {
          error:
            "Name, email, and a password of at least 6 characters are required."
        });
      }

      let user =
        await getUserByEmail(email);

      if (!user) {
        const allowedNewRole =
          ["Learner", "Trainer", "Management"]
            .includes(requestedRole)
            ? requestedRole
            : "Learner";

        const newUser = {
          name,
          email,
          password:
            await hashPassword(password),
          role: allowedNewRole,
          status: "Active",
          joined_at: new Date().toISOString(),
          progress: 0
        };

        const created =
          await supabaseRequest(
            "users",
            {
              method: "POST",
              body: newUser
            }
          );

        user = created[0];
      } else {
        const matched =
          await passwordMatches(
            password,
            user.password
          );

        if (!matched) {
          return sendJson(res, 401, {
            error:
              "Incorrect password. Please try again."
          });
        }
      }

      await supabaseRequest(
        "activity_logs",
        {
          method: "POST",
          body: {
            user_id: user.id,
            activity_type: "login",
            activity_text:
              `${user.name} logged in`
          }
        }
      );

      return sendJson(res, 200, {
        user: safeUser(user)
      });
    }

    // ----------------------------------------
    // COURSES - GET
    // ----------------------------------------

    if (
      req.method === "GET" &&
      pathname === "/api/courses"
    ) {
      const courses =
        await supabaseRequest(
          "courses?select=*&order=created_at.desc"
        );

      return sendJson(
        res,
        200,
        courses || []
      );
    }

    // ----------------------------------------
    // COURSES - CREATE
    // ----------------------------------------

    if (
      req.method === "POST" &&
      pathname === "/api/courses"
    ) {
      const body = await readBody(req);

      const email =
        String(body.email || "")
          .trim()
          .toLowerCase();

      const user =
        await getUserByEmail(email);

      if (
        !user ||
        !["Admin", "Trainer"].includes(user.role)
      ) {
        return sendJson(res, 403, {
          error:
            "Only an Admin or Trainer can create a course."
        });
      }

      const title =
        String(body.title || "").trim();

      const category =
        String(body.category || "").trim();

      const duration =
        String(body.duration || "").trim();

      const description =
        String(body.description || "").trim();

      if (
        !title ||
        !category ||
        !duration ||
        !description
      ) {
        return sendJson(res, 400, {
          error:
            "Please complete every course field."
        });
      }

      const created =
        await supabaseRequest(
          "courses",
          {
            method: "POST",
            body: {
              title,
              category,
              duration,
              description,
              trainer_id:
                user.role === "Trainer"
                  ? user.id
                  : null
            }
          }
        );

      await supabaseRequest(
        "activity_logs",
        {
          method: "POST",
          body: {
            user_id: user.id,
            activity_type: "course_created",
            activity_text:
              `${user.name} created ${title}`
          }
        }
      );

      return sendJson(res, 201, {
        course: created[0]
      });
    }

    // ----------------------------------------
    // ENROLLMENTS - CREATE
    // ----------------------------------------

    if (
      req.method === "POST" &&
      pathname === "/api/enrollments"
    ) {
      const body = await readBody(req);

      const email =
        String(body.email || "")
          .trim()
          .toLowerCase();

      const courseId =
        Number(body.courseId);

      const user =
        await getUserByEmail(email);

      if (!user) {
        return sendJson(res, 400, {
          error: "User was not found."
        });
      }

      const courses =
        await supabaseRequest(
          `courses?id=eq.${courseId}&select=*`
        );

      const course = courses?.[0];

      if (!course) {
        return sendJson(res, 400, {
          error: "Course was not found."
        });
      }

      const existing =
        await supabaseRequest(
          `enrollments?user_id=eq.${user.id}&course_id=eq.${courseId}&select=*`
        );

      if (existing?.length) {
        return sendJson(res, 409, {
          error:
            "You are already enrolled in this course."
        });
      }

      const enrollment =
        await supabaseRequest(
          "enrollments",
          {
            method: "POST",
            body: {
              user_id: user.id,
              course_id: courseId,
              progress: 0
            }
          }
        );

      await supabaseRequest(
        "activity_logs",
        {
          method: "POST",
          body: {
            user_id: user.id,
            activity_type: "course_enrolled",
            activity_text:
              `${user.name} enrolled in ${course.title}`
          }
        }
      );

      return sendJson(res, 201, {
        enrollment: enrollment[0]
      });
    }

    // ----------------------------------------
    // ENROLLMENTS - GET USER COURSES
    // ----------------------------------------

    if (
      req.method === "GET" &&
      pathname === "/api/enrollments"
    ) {
      const email =
        String(
          url.searchParams.get("email") || ""
        )
          .trim()
          .toLowerCase();

      const user =
        await getUserByEmail(email);

      if (!user) {
        return sendJson(res, 200, []);
      }

      const enrollments =
        await supabaseRequest(
          `enrollments?user_id=eq.${user.id}&select=*&order=enrolled_at.desc`
        );

      const result = [];

      for (const item of enrollments || []) {
        const courses =
          await supabaseRequest(
            `courses?id=eq.${item.course_id}&select=*`
          );

        result.push({
          ...item,
          course: courses?.[0] || null
        });
      }

      return sendJson(
        res,
        200,
        result
      );
    }

    // ----------------------------------------
    // PROGRESS
    // ----------------------------------------

    if (
      req.method === "POST" &&
      pathname === "/api/enrollments/progress"
    ) {
      const body = await readBody(req);

      const email =
        String(body.email || "")
          .trim()
          .toLowerCase();

      const courseId =
        Number(body.courseId);

      const progress =
        Math.min(
          100,
          Math.max(
            0,
            Number(body.progress) || 0
          )
        );

      const user =
        await getUserByEmail(email);

      if (!user) {
        return sendJson(res, 404, {
          error: "User was not found."
        });
      }

      const existing =
        await supabaseRequest(
          `enrollments?user_id=eq.${user.id}&course_id=eq.${courseId}&select=*`
        );

      if (!existing?.length) {
        return sendJson(res, 404, {
          error:
            "Enroll in this course before updating progress."
        });
      }

      const updated =
        await supabaseRequest(
          `enrollments?id=eq.${existing[0].id}`,
          {
            method: "PATCH",
            body: {
              progress,
              completed_at:
                progress === 100
                  ? new Date().toISOString()
                  : null
            }
          }
        );

      return sendJson(res, 200, {
        enrollment: updated[0]
      });
    }

    // ----------------------------------------
    // QUIZ RESULTS
    // ----------------------------------------

    if (
      req.method === "POST" &&
      pathname === "/api/quiz-results"
    ) {
      const body = await readBody(req);

      const email =
        String(body.email || "")
          .trim()
          .toLowerCase();

      const courseId =
        Number(body.courseId);

      const score =
        Math.min(
          100,
          Math.max(
            0,
            Number(body.score) || 0
          )
        );

      const totalQuestions =
        Math.max(
          1,
          Number(body.totalQuestions) || 1
        );

      const user =
        await getUserByEmail(email);

      if (!user) {
        return sendJson(res, 400, {
          error: "User was not found."
        });
      }

      const courses =
        await supabaseRequest(
          `courses?id=eq.${courseId}&select=*`
        );

      const course = courses?.[0];

      if (!course) {
        return sendJson(res, 400, {
          error: "Course was not found."
        });
      }

      const passed = score >= 70;

      const result =
        await supabaseRequest(
          "quiz_results",
          {
            method: "POST",
            body: {
              user_id: user.id,
              course_id: courseId,
              score,
              total_questions: totalQuestions,
              passed
            }
          }
        );

      let certificate = null;

      if (passed) {
        const existing =
          await supabaseRequest(
            `certificates?user_id=eq.${user.id}&course_id=eq.${courseId}&select=*`
          );

        if (existing?.length) {
          certificate = existing[0];
        } else {
          const created =
            await supabaseRequest(
              "certificates",
              {
                method: "POST",
                body: {
                  user_id: user.id,
                  course_id: courseId,
                  certificate_name:
                    course.title
                }
              }
            );

          certificate = created[0];
        }
      }

      await supabaseRequest(
        "activity_logs",
        {
          method: "POST",
          body: {
            user_id: user.id,
            activity_type: "quiz_completed",
            activity_text:
              `${user.name} completed ${course.title} quiz`
          }
        }
      );

      return sendJson(res, 201, {
        result: result[0],
        certificate
      });
    }

    // ----------------------------------------
    // CERTIFICATES
    // ----------------------------------------

    if (
      req.method === "GET" &&
      pathname === "/api/certificates"
    ) {
      const email =
        String(
          url.searchParams.get("email") || ""
        )
          .trim()
          .toLowerCase();

      const user =
        await getUserByEmail(email);

      if (!user) {
        return sendJson(res, 200, []);
      }

      const certificates =
        await supabaseRequest(
          `certificates?user_id=eq.${user.id}&select=*`
        );

      const result = [];

      for (const item of certificates || []) {
        const courses =
          await supabaseRequest(
            `courses?id=eq.${item.course_id}&select=*`
          );

        const course = courses?.[0];

        result.push({
          ...item,
          title:
            item.certificate_name ||
            course?.title ||
            "Certificate",
          issuedAt: item.issued_at
        });
      }

      return sendJson(
        res,
        200,
        result
      );
    }

    // ----------------------------------------
    // ADMIN USERS
    // ----------------------------------------

    if (
      req.method === "GET" &&
      pathname === "/api/admin/users"
    ) {
      const email =
        String(
          url.searchParams.get("email") || ""
        )
          .trim()
          .toLowerCase();

      const admin =
        await getAdminByEmail(email);

      if (!admin) {
        return sendJson(res, 403, {
          error:
            "Administrator access is required."
        });
      }

      const users =
        await supabaseRequest(
          "users?select=id,name,email,role,status,joined_at,progress&order=joined_at.desc"
        );

      return sendJson(
        res,
        200,
        users || []
      );
    }

    // ----------------------------------------
    // ADMIN SUMMARY
    // ----------------------------------------

    if (
      req.method === "GET" &&
      pathname === "/api/admin/summary"
    ) {
      const email =
        String(
          url.searchParams.get("email") || ""
        )
          .trim()
          .toLowerCase();

      const admin =
        await getAdminByEmail(email);

      if (!admin) {
        return sendJson(res, 403, {
          error:
            "Administrator access is required."
        });
      }

      const users =
        await supabaseRequest(
          "users?select=id"
        );

      const courses =
        await supabaseRequest(
          "courses?select=id"
        );

      const enrollments =
        await supabaseRequest(
          "enrollments?select=id,progress"
        );

      const certificates =
        await supabaseRequest(
          "certificates?select=id"
        );

      const completed =
        (enrollments || [])
          .filter(
            item =>
              Number(item.progress) === 100
          )
          .length;

      return sendJson(res, 200, {
        users: users?.length || 0,
        courses: courses?.length || 0,
        enrollments:
          enrollments?.length || 0,
        completed,
        certificates:
          certificates?.length || 0
      });
    }

    // ----------------------------------------
    // HEALTH
    // ----------------------------------------

    if (
      req.method === "GET" &&
      pathname === "/api/health"
    ) {
      const courses =
        await supabaseRequest(
          "courses?select=id"
        );

      return sendJson(res, 200, {
        status: "ok",
        message:
          "Capacity Connect database is connected",
        courses:
          courses?.length || 0
      });
    }

    return sendJson(res, 404, {
      error:
        `API route not found: ${pathname}`
    });

  } catch (error) {
    console.error(error);

    return sendJson(res, 500, {
      error:
        error?.message ||
        "Internal server error"
    });
  }
};