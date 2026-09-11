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

  const users =
    await supabaseRequest(
      `users?email=eq.${encodeURIComponent(email)}&select=*`
    );

  return users?.[0] || null;
}

module.exports = async function handler(req, res) {

  try {

    const url = new URL(
      req.url,
      `https://${req.headers.host || "localhost"}`
    );

    // GET /api/enrollments?email=...
    if (req.method === "GET") {

      const email =
        String(
          url.searchParams.get("email") || ""
        )
          .trim()
          .toLowerCase();

      if (!email) {
        return res.status(400).json({
          error: "Email is required."
        });
      }

      const user =
        await getUserByEmail(email);

      if (!user) {
        return res.status(200).json([]);
      }

      const enrollments =
        await supabaseRequest(
          `enrollments?user_id=eq.${user.id}&select=*&order=enrolled_at.desc`
        );

      const result = [];

      for (
        const enrollment
        of enrollments || []
      ) {

        const courses =
          await supabaseRequest(
            `courses?id=eq.${enrollment.course_id}&select=*`
          );

        result.push({
          ...enrollment,

          course:
            courses?.[0] || null
        });
      }

      return res.status(200).json(
        result
      );
    }

    // POST /api/enrollments
    if (req.method === "POST") {

      const body = req.body || {};

      const email =
        String(body.email || "")
          .trim()
          .toLowerCase();

      const courseId =
        Number(body.courseId);

      if (!email || !courseId) {
        return res.status(400).json({
          error:
            "Email and courseId are required."
        });
      }

      const user =
        await getUserByEmail(email);

      if (!user) {
        return res.status(404).json({
          error:
            "User was not found."
        });
      }

      const courses =
        await supabaseRequest(
          `courses?id=eq.${courseId}&select=*`
        );

      const course =
        courses?.[0];

      if (!course) {
        return res.status(404).json({
          error:
            "Course was not found."
        });
      }

      const existing =
        await supabaseRequest(
          `enrollments?user_id=eq.${user.id}&course_id=eq.${courseId}&select=*`
        );

      if (existing?.length) {
        return res.status(409).json({
          error:
            "You are already enrolled in this course."
        });
      }

      const created =
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

      return res.status(201).json({
        enrollment:
          created[0]
      });
    }

    return res.status(405).json({
      error:
        "Method not allowed"
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