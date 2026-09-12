async function supabaseRequest(path, options = {}) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/${path}`,
    {
      method: options.method || "GET",

      headers: {
        apikey:
          process.env.SUPABASE_SERVICE_ROLE_KEY,

        Authorization:
          `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,

        "Content-Type":
          "application/json",

        Prefer:
          "return=representation"
      },

      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(options.body)
    }
  );

  const text =
    await response.text();

  let data;

  try {
    data = text
      ? JSON.parse(text)
      : null;
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

async function getCourse(courseId) {
  const courses =
    await supabaseRequest(
      `courses?id=eq.${courseId}&select=*`
    );

  return courses?.[0] || null;
}

async function getEnrollment(
  userId,
  courseId
) {
  const enrollments =
    await supabaseRequest(
      `enrollments?user_id=eq.${userId}&course_id=eq.${courseId}&select=*`
    );

  return enrollments?.[0] || null;
}

module.exports =
  async function handler(req, res) {

    try {

      if (req.method !== "POST") {
        return res.status(405).json({
          error:
            "Method not allowed"
        });
      }

      const body =
        req.body || {};

      const email =
        String(
          body.email || ""
        )
          .trim()
          .toLowerCase();

      const courseId =
        Number(body.courseId);

      const score =
        Math.max(
          0,
          Math.min(
            100,
            Number(body.score) || 0
          )
        );

      if (!email || !courseId) {
        return res.status(400).json({
          error:
            "Email and courseId are required."
        });
      }

      const user =
        await getUserByEmail(
          email
        );

      if (!user) {
        return res.status(404).json({
          error:
            "User was not found."
        });
      }

      const course =
        await getCourse(
          courseId
        );

      if (!course) {
        return res.status(404).json({
          error:
            "Course was not found."
        });
      }

      const passed =
        score >= 70;

      /*
       * Make sure an enrollment exists.
       * A quiz submission should create
       * the learner's course record if
       * it does not already exist.
       */

      let enrollment =
        await getEnrollment(
          user.id,
          courseId
        );

      if (!enrollment) {

        const created =
          await supabaseRequest(
            "enrollments",
            {
              method: "POST",

              body: {
                user_id:
                  user.id,

                course_id:
                  courseId,

                progress:
                  passed
                    ? 100
                    : 25
              }
            }
          );

        enrollment =
          created?.[0];

      } else {

        const newProgress =
          passed
            ? 100
            : Math.max(
                Number(
                  enrollment.progress || 0
                ),
                25
              );

        const updated =
          await supabaseRequest(
            `enrollments?id=eq.${enrollment.id}`,
            {
              method: "PATCH",

              body: {
                progress:
                  newProgress
              }
            }
          );

        enrollment =
          updated?.[0] ||
          enrollment;
      }

      /*
       * Save quiz result.
       */

      const quizResult =
        await supabaseRequest(
          "quiz_results",
          {
            method: "POST",

            body: {
              user_id:
                user.id,

              course_id:
                courseId,

              score,

              total_questions:
                1,

              passed,

              taken_at:
                new Date().toISOString()
            }
          }
        );

      /*
       * If passed, create certificate.
       */

      let certificate =
        null;

      if (passed) {

        const existing =
          await supabaseRequest(
            `certificates?user_id=eq.${user.id}&course_id=eq.${courseId}&select=*`
          );

        if (
          existing &&
          existing.length
        ) {

          certificate =
            existing[0];

        } else {

          const created =
            await supabaseRequest(
              "certificates",
              {
                method: "POST",

                body: {
                  user_id:
                    user.id,

                  course_id:
                    courseId,

                  certificate_name:
                    course.title,

                  issued_at:
                    new Date().toISOString()
                }
              }
            );

          certificate =
            created?.[0] ||
            null;
        }
      }

      return res.status(201).json({
        result:
          quizResult?.[0] ||
          null,

        enrollment,

        certificate,

        message:
          passed
            ? "Quiz passed. Your course is completed."
            : "Quiz submitted. Your progress is now 25%."
      });

    } catch (error) {

      console.error(
        "Quiz result error:",
        error
      );

      return res.status(500).json({
        error:
          error.message ||
          "Could not save quiz result."
      });
    }
  };