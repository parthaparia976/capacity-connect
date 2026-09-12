const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const hash = await scrypt(
    password,
    salt,
    64
  );

  return `${salt}:${hash.toString("hex")}`;
}

async function passwordMatches(password, stored) {
  if (!stored || !stored.includes(":")) {
    return false;
  }

  const [salt, savedHash] = stored.split(":");

  const hash = await scrypt(
    password,
    salt,
    64
  );

  return hash.toString("hex") === savedHash;
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/${path}`,
    {
      method: options.method || "GET",

      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
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
    data = {
      error: text
    };
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      "Supabase request failed"
    );
  }

  return data;
}

async function getUserByEmail(email) {
  const users = await supabaseRequest(
    `users?email=eq.${encodeURIComponent(email)}&select=*`
  );

  return users?.[0] || null;
}

module.exports = async function handler(req, res) {
  try {

    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const body = req.body || {};

    const name =
      String(body.name || "").trim();

    const email =
      String(body.email || "")
        .trim()
        .toLowerCase();

    const password =
      String(body.password || "");

    const role =
      [
        "Learner",
        "Trainer",
        "Admin",
        "Management"
      ].includes(body.role)
        ? body.role
        : "Learner";

    if (
      !name ||
      !email ||
      password.length < 6
    ) {
      return res.status(400).json({
        error:
          "Name, email, and a password of at least 6 characters are required."
      });
    }

    let user =
      await getUserByEmail(email);

    /*
     * NEW USER
     */
    if (!user) {

      const created =
        await supabaseRequest(
          "users",
          {
            method: "POST",

            body: {
              name,
              email,
              password:
                await hashPassword(password),
              role,
              status: "Active",
              progress: 0
            }
          }
        );

      user = created[0];

    }

    /*
     * EXISTING USER
     */
    else {

      const matches =
        await passwordMatches(
          password,
          user.password
        );

      if (!matches) {

        return res.status(401).json({
          error:
            "Incorrect password. Please try again."
        });
      }
    }

    /*
     * NEVER SEND PASSWORD TO BROWSER
     */
    const {
      password: hiddenPassword,
      ...safeUser
    } = user;

    return res.status(200).json({
      user: safeUser
    });

  } catch (error) {

    console.error(
      "Login error:",
      error
    );

    return res.status(500).json({
      error:
        error.message ||
        "Internal server error"
    });
  }
};