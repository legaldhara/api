export const getWelcomeEmail = (fullName: string) => ({
  subject: "Welcome to LegalDhara!",
  text: `Hi ${fullName},

Welcome to LegalDhara – your trusted digital platform for seamless legal solutions.
We're excited to have you join our community of clients, lawyers, and legal experts.

Login now to explore our services: https://legaldhara.in/login

Best regards,
The LegalDhara Team
`,
  html: `
  <div style="font-family: Arial, sans-serif; color: #333; background-color: #f7f8fa; padding: 30px; border-radius: 10px;">
    <div style="text-align: center; margin-bottom: 20px;">
      <img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS8keYYC7lDnHfAqE6F6OANAO34wxOx0JP_tg&s" alt="LegalDhara Logo" width="120" style="margin-bottom: 20px;" />
    </div>

    <h2 style="color: #2b2b2b;">Welcome to LegalDhara, ${fullName}!</h2>
    <p>We're delighted to have you onboard. LegalDhara helps you manage your legal needs with trusted professionals and transparent services—all from one secure platform.</p>

    <p>Start your journey today and access your dashboard to explore our legal services and resources.</p>

    <div style="text-align: center; margin-top: 30px;">
      <a href="https://legaldhara.in/login"
         style="background-color: #007bff; color: #fff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600;">
         Login to Your Account
      </a>
    </div>

    <p style="margin-top: 30px;">Warm regards,<br><strong>The LegalDhara Team</strong></p>

    <div style="background-color: #f1f1f1; text-align: center; padding: 20px; font-size: 13px; color: #777;">
      <p>Need help? Contact us at <a href="mailto:support@legaldhara.in" style="color: #007bff;">support@legaldhara.in</a> or call <a href="tel:+919876543210" style="color: #007bff;">+91-98765-43210</a></p>
      <p>Visit our website: <a href="https://legaldhara.in" style="color: #007bff;">www.legaldhara.in</a></p>
      <p>Follow us: 
        <a href="https://www.facebook.com/legaldhara" style="color: #007bff;">Facebook</a> • 
        <a href="https://www.instagram.com/legaldhara" style="color: #007bff;">Instagram</a> • 
        <a href="https://www.linkedin.com/company/legaldhara" style="color: #007bff;">LinkedIn</a>
      </p>
      <p>© ${new Date().getFullYear()} LegalDhara. All rights reserved.</p>
    </div>
  </div>
  `
});

export const getPaymentStatusEmail = ({
  fullName,
  paymentStatus,
  ticketNo,
  amount,
  applicationStatus,
}: {
  fullName: string;
  paymentStatus: "SUCCESS" | "FAILED" | 'PENDING';
  ticketNo: string;
  amount: number | string;
  applicationStatus: string;
}) => {
  const isSuccess = paymentStatus === "SUCCESS";

  const subject = isSuccess
    ? `Payment Successful - Ticket #${ticketNo}`
    : `Payment Failed - Ticket #${ticketNo}`;

  const text = isSuccess
    ? `Hi ${fullName},

Your payment of ₹${amount} for Ticket No: ${ticketNo} was successful.
Your application is now under review. Current status: ${applicationStatus}.

Thank you for choosing LegalDhara!
`
    : `Hi ${fullName},

Your payment of ₹${amount} for Ticket No: ${ticketNo} has failed.
Please retry your payment to continue the process.

Current status: ${applicationStatus}.
`;

  const html = `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #f4f6f8; padding: 40px;">
    <div style="max-width: 600px; margin: auto; background: #fff; border-radius: 10px; box-shadow: 0 3px 10px rgba(0,0,0,0.1); overflow: hidden;">
      <div style="background-color: ${isSuccess ? "#28a745" : "#dc3545"}; color: white; padding: 20px; text-align: center;">
        <h2 style="margin: 0;">${isSuccess ? "Payment Successful" : "Payment Failed"}</h2>
      </div>

      <div style="padding: 30px;">
        <p style="font-size: 16px;">Hi <strong>${fullName}</strong>,</p>

        ${isSuccess
      ? `<p>Your payment of <strong>₹${amount}</strong> for <strong>Ticket No: ${ticketNo}</strong> was successful.</p>
               <p>Your application is now <strong>${applicationStatus}</strong> and will be reviewed shortly.</p>`
      : `<p>Your payment of <strong>₹${amount}</strong> for <strong>Ticket No: ${ticketNo}</strong> has <strong>failed</strong>.</p>
               <p>Please retry your payment to continue processing your application.</p>`
    }

        <div style="background-color: #f8f9fa; border-radius: 8px; padding: 15px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Ticket No:</strong> ${ticketNo}</p>
          <p style="margin: 0;"><strong>Amount:</strong> ₹${amount}</p>
          <p style="margin: 0;"><strong>Current Status:</strong> ${applicationStatus}</p>
        </div>

        <div style="text-align: center; margin-top: 30px;">
          <a href="https://legaldhara.in/login"
            style="background-color: ${isSuccess ? "#007bff" : "#6c757d"}; color: #fff;
                   padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            ${isSuccess ? "View Application" : "Retry Payment"}
          </a>
        </div>

        <p style="margin-top: 30px; color: #555;">Warm regards,<br><strong>The LegalDhara Team</strong></p>
      </div>

       <div style="background-color: #f1f1f1; text-align: center; padding: 20px; font-size: 13px; color: #777;">
        <p>Need help? Contact us at <a href="mailto:support@legaldhara.in" style="color: #007bff;">support@legaldhara.in</a> or call <a href="tel:+919876543210" style="color: #007bff;">+91-98765-43210</a></p>
        <p>Visit our website: <a href="https://legaldhara.in" style="color: #007bff;">www.legaldhara.in</a></p>
        <p>Follow us: 
          <a href="https://www.facebook.com/legaldhara" style="color: #007bff;">Facebook</a> • 
          <a href="https://www.instagram.com/legaldhara" style="color: #007bff;">Instagram</a> • 
          <a href="https://www.linkedin.com/company/legaldhara" style="color: #007bff;">LinkedIn</a>
        </p>
        <p>© ${new Date().getFullYear()} LegalDhara. All rights reserved.</p>
      </div>
    </div>
  </div>
  `;

  return { subject, text, html };
};


export const getPaymentStatusEmailForCertificate = ({
  fullName,
  paymentStatus,
  requestNo,
  amount,
  status,
}: {
  fullName: string;
  paymentStatus: "SUCCESS" | "FAILED" | 'PENDING';
  requestNo: string;
  amount: number | string;
  status: string;
}) => {
  const isSuccess = paymentStatus === "SUCCESS";

  const subject = isSuccess
    ? `Payment Successful - Request #${requestNo}`
    : `Payment Failed - Request #${requestNo}`;

  const text = isSuccess
    ? `Hi ${fullName},

Your payment of ₹${amount} for Request No: ${requestNo} was successful.
Your certificate request is now under review. Current status: ${status.split("_").join(" ").toUpperCase()}.

Thank you for choosing LegalDhara!
`
    : `Hi ${fullName},

Your payment of ₹${amount} for Request No: ${requestNo} has failed.
Please retry your payment to continue the process.

Current status: ${status.split("_").join(" ").toUpperCase()}.
`;

  const html = `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #f4f6f8; padding: 40px;">
    <div style="max-width: 600px; margin: auto; background: #fff; border-radius: 10px; box-shadow: 0 3px 10px rgba(0,0,0,0.1); overflow: hidden;">
      <div style="background-color: ${isSuccess ? "#28a745" : "#dc3545"}; color: white; padding: 20px; text-align: center;">
        <h2 style="margin: 0;">${isSuccess ? "Payment Successful" : "Payment Failed"}</h2>
      </div>

      <div style="padding: 30px;">
        <p style="font-size: 16px;">Hi <strong>${fullName}</strong>,</p>

        ${isSuccess
      ? `<p>Your payment of <strong>₹${amount}</strong> for <strong>Request No: ${requestNo}</strong> was successful.</p>
               <p>Your certificate request is now <strong>${status.split("_").join(" ").toUpperCase()}</strong> and will be reviewed shortly.</p>`
      : `<p>Your payment of <strong>₹${amount}</strong> for <strong>Request No: ${requestNo}</strong> has <strong>failed</strong>.</p>
               <p>Please retry your payment to continue processing your certificate request.</p>`
    }

        <div style="background-color: #f8f9fa; border-radius: 8px; padding: 15px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Request No:</strong> ${requestNo}</p>
          <p style="margin: 0;"><strong>Amount:</strong> ₹${amount}</p>
          <p style="margin: 0;"><strong>Current Status:</strong> ${status.split("_").join(" ").toUpperCase()}</p>
        </div>

        <div style="text-align: center; margin-top: 30px;">
          <a href="https://legaldhara.in/login"
            style="background-color: ${isSuccess ? "#007bff" : "#6c757d"}; color: #fff;
                   padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            ${isSuccess ? "View Application" : "Retry Payment"}
          </a>
        </div>

        <p style="margin-top: 30px; color: #555;">Warm regards,<br><strong>The LegalDhara Team</strong></p>
      </div>

       <div style="background-color: #f1f1f1; text-align: center; padding: 20px; font-size: 13px; color: #777;">
        <p>Need help? Contact us at <a href="mailto:support@legaldhara.in" style="color: #007bff;">support@legaldhara.in</a> or call <a href="tel:+919876543210" style="color: #007bff;">+91-98765-43210</a></p>
        <p>Visit our website: <a href="https://legaldhara.in" style="color: #007bff;">www.legaldhara.in</a></p>
        <p>Follow us: 
          <a href="https://www.facebook.com/legaldhara" style="color: #007bff;">Facebook</a> • 
          <a href="https://www.instagram.com/legaldhara" style="color: #007bff;">Instagram</a> • 
          <a href="https://www.linkedin.com/company/legaldhara" style="color: #007bff;">LinkedIn</a>
        </p>
        <p>© ${new Date().getFullYear()} LegalDhara. All rights reserved.</p>
      </div>
    </div>
  </div>
  `;

  return { subject, text, html };
};



export const getQueryReceivedEmail = (fullName: string, queryNo: string) => ({
  subject: "We Have Received Your Query",
  text: `Hi ${fullName},

Thank you for reaching out to us. We have received your query (Query No: ${queryNo}) and our team will get back to you shortly.

Best regards,
The LegalDhara Team
`,
  html: `
  <div style="font-family: 'Segoe UI', Arial, sans-serif;">
    <h2>Hi ${fullName},</h2>
    <p>Thank you for reaching out to us. We have received your query and our team will get back to you shortly.</p>

    <div style="background-color: #f1f1f1; text-align: center; padding: 20px; font-size: 13px; color: #777;">
      <p>Need help? Contact us at <a href="mailto:support@legaldhara.in" style="color: #007bff;">support@legaldhara.in</a> or call <a href="tel:+919876543210" style="color: #007bff;">+91-98765-43210</a></p>
      <p>Visit our website: <a href="https://legaldhara.in" style="color: #007bff;">www.legaldhara.in</a></p>
      <p>Follow us: 
        <a href="https://www.facebook.com/legaldhara" style="color: #007bff;">Facebook</a> • 
        <a href="https://www.instagram.com/legaldhara" style="color: #007bff;">Instagram</a> • 
        <a href="https://www.linkedin.com/company/legaldhara" style="color: #007bff;">LinkedIn</a>
      </p>
      <p>© ${new Date().getFullYear()} LegalDhara. All rights reserved.</p>
    </div>
  </div>
  `,
});

export const getQueryResolvedEmail = (fullName: string, response: string) => ({
  subject: "Your Query Has Been Resolved",
  text: `Hi ${fullName},
Your query has been resolved. Here is the response from our team:

${response}
Best regards,
The LegalDhara Team
`,
  html: `
  <div style="font-family: 'Segoe UI', Arial, sans-serif;">

    <h2>Hi ${fullName},</h2>
    <p>Your query has been resolved. Here is the response from our team:</p>
    <div style="background-color: #f8f9fa; border-left: 4px solid #007bff; padding: 15px; margin: 20px 0;">
      <p style="margin: 0;">${response}</p>
    </div>
    <p>Best regards,<br><strong>The LegalDhara Team</strong></p>

    <div style="background-color: #f1f1f1; text-align: center; padding: 20px; font-size: 13px; color: #777;">
      <p>Need help? Contact us at <a href="mailto:support@legaldhara.in" style="color: #007bff;">support@legaldhara.in</a> or call <a href="tel:+919876543210" style="color: #007bff;">+91-98765-43210</a></p>
      <p>Visit our website: <a href="https://legaldhara.in" style="color: #007bff;">www.legaldhara.in</a></p>
      <p>Follow us:
        <a href="https://www.facebook.com/legaldhara" style="color: #007bff;">Facebook</a> •
        <a href="https://www.instagram.com/legaldhara" style="color: #007bff;">Instagram</a> •
        <a href="https://www.linkedin.com/company/legaldhara" style="color: #007bff;">LinkedIn</a>
      </p>
      <p>© ${new Date().getFullYear()} LegalDhara. All rights reserved.</p>
    </div>
  </div>
  `,
});

const escapeEmailHtml = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

export const getCaseUpdateEmail = (input: {
  fullName: string;
  title: string;
  body: string;
  clickAction: string;
}) => {
  const appUrl = (process.env.WEBSITE_APP_URL || "https://legaldhara.com").replace(/\/$/, "");
  const url = `${appUrl}${input.clickAction.startsWith("/") ? input.clickAction : `/${input.clickAction}`}`;
  const fullName = escapeEmailHtml(input.fullName);
  const title = escapeEmailHtml(input.title);
  const body = escapeEmailHtml(input.body);
  return {
    subject: input.title,
    text: `Hi ${input.fullName},\n\n${input.body}\n\nView your request: ${url}\n\nLegalDhara`,
    html: `<div style="font-family:Arial,sans-serif;color:#151515;line-height:1.6"><h2>${title}</h2><p>Hi ${fullName},</p><p>${body}</p><p><a href="${escapeEmailHtml(url)}">View your request</a></p><p>LegalDhara</p></div>`,
  };
};
