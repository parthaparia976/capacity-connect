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
    if (req.method !== "GET") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const url = new URL(
      req.url,
      `https://${req.headers.host || "localhost"}`
    );

    const adminEmail =
      String(
        url.searchParams.get("email") || ""
      )
        .trim()
        .toLowerCase();

    if (!adminEmail) {
      return res.status(400).json({
        error: "Admin email is required."
      });
    }

    const admin =
      await getUserByEmail(adminEmail);

    if (!admin || admin.role !== "Admin") {
      return res.status(403).json({
        error:
          "Administrator access is required."
      });
    }

    const users =
      await supabaseRequest(
        "users?select=id,name,email,role,status,joined_at,progress&order=joined_at.desc"
      );

    const result = [];

    for (const user of users || []) {

      const enrollments =
        await supabaseRequest(
          `enrollments?user_id=eq.${user.id}&select=id,course_id,progress,enrolled_at,completed_at`
        );

      const quizResults =
        await supabaseRequest(
          `quiz_results?user_id=eq.${user.id}&select=id,course_id,score,total_questions,passed,taken_at`
        );

      const certificates =
        await supabaseRequest(
          `certificates?user_id=eq.${user.id}&select=id,course_id,certificate_name,issued_at`
        );

      result.push({
        ...user,

        courses:
          enrollments?.length || 0,

        progress:
          Number(user.progress || 0),

        enrollments:
          enrollments || [],

        quizResults:
          quizResults || [],

        certificates:
          certificates || []
      });
    }

    return res.status(200).json(result);

  } catch (error) {

    console.error(
      "Admin users error:",
      error
    );

    return res.status(500).json({
      error:
        error.message ||
        "Unable to load users."
    });
  }
};