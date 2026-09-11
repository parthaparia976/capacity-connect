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

    // GET /api/courses
    if (req.method === "GET") {

      const courses = await supabaseRequest(
        "courses?select=*&order=created_at.desc"
      );

      return res.status(200).json(
        courses || []
      );
    }

    // POST /api/courses
    if (req.method === "POST") {

      const body = req.body || {};

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
        return res.status(403).json({
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
        return res.status(400).json({
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

      return res.status(201).json({
        course: created[0]
      });
    }

    return res.status(405).json({
      error: "Method not allowed"
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error:
        error.message ||
        "Internal server error"
    });
  }
};