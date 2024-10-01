import sgMail from '@sendgrid/mail';
import client from '@sendgrid/client';

export const handler = async (event) => {
  console.log('Function started');

  // Set the SendGrid API key for both mail and client
  console.log('Setting API key');
  const apiKey = process.env.SENDGRID_API_KEY;
  sgMail.setApiKey(apiKey);
  client.setApiKey(apiKey);
  console.log('API key set');


  async function createNewsletter() {

    const SYSTEM_PROMPT = `
      Be friendly, interesting and scientific.
    `;
    const USER_PROMPT = `
      Pretend you are the creator of a daily email newsletter. Craft an email with basic HTML formatting, that includes the following sections:
       - An inspirational quote
       - A 1-2 paragraph write-up of a current event or interesting topic from technology, politics, fashion, entertainment, or science.
       - A link to information where I can learn more about the topic above
       - An human interest story about a real person with a relevant connection to today's newsletter topic
       - A link to learn more about this person's work or life
       - An embedded YouTube video I might enjoy, related to the same topic as the email so far
       - A podcast I might enjoy listening to
       The newsletter should be returned as the body of a simple HTML email, with no additional commentary, in a <div> container tag.
    `;

    const optionsBody = {
      model: "llama-3.1-sonar-large-128k-online",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_PROMPT }
      ],
      // max_tokens: "Optional",
      temperature: 0.2,
      top_p: 0.9,
      return_citations: true,
      // search_domain_filter: ["perplexity.ai"],
      return_images: false,
      return_related_questions: false,
      search_recency_filter: "month",
      top_k: 0,
      stream: false,
      presence_penalty: 0,
      frequency_penalty: 1
    }

    const options = {
      method: 'POST',
      headers: {Authorization: 'Bearer '+process.env.PERPLEXITY_API_KEY, 'Content-Type': 'application/json'},
      body: JSON.stringify(optionsBody)
    };
    
    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', options);
      const data = await response.json();
      const responseBody = data.choices[0].message.content;
      const responseBodyFixed = responseBody.replace(/^```html\n|\n```$/g, '');
      console.log(responseBodyFixed);
      return responseBodyFixed;
    } catch (err) {
      console.error('Error fetching from Perplexity API:', err);
      throw err;
    }
  }

  // Function to send email
  async function sendEmail(recipientEmail, recipientFirstName) {
    
    const newsletterContent = await createNewsletter();
    
    const msg = {
      to: recipientEmail,
      from: 'mynews@aidaily.me',
      subject: `Hi ${recipientFirstName}, here's your daily newsletter!`,
      html: newsletterContent
    };

    console.log('Sending email with payload:', JSON.stringify(msg, null, 2));

    try {
      await sgMail.send(msg);
      return 'Email sent successfully';
    } catch (error) {
      throw new Error('Error sending email');
    }
  }

  // Function to fetch contacts
  async function getContacts() {
     let allContacts = [];
     let pageCursor = null;
    
     do {
        try {
          const [response, body] = await client.request({
            method: 'GET',
            url: '/v3/marketing/contacts',
            qs: {
              list_ids: process.env.SENDGRID_LIST_ID,
              page_size: 1000,
              ...(pageCursor && { page_token: pageCursor }),
              fields: 'email,first_name',
            }
          });
          
          console.log(`API Response Status: ${response.statusCode}`);
          console.log(`Body: ${JSON.stringify(body)}`);
    
          allContacts = [...allContacts, ...body.result];
          pageCursor = body._metadata.next;
        } catch (error) {
          console.error('Error fetching contacts:', error.response?.body || error.message);
          break;
        }
      } while (pageCursor);
      
      return allContacts;
  }
  
  async function sendEmailsToList(contacts) {
    console.log('Starting to send emails to the contact list...');
    const results = [];

    for (const contact of contacts) {
      try {
        const result = await sendEmail(contact.email, contact.first_name);
        results.push({ email: contact.email, status: 'success', message: result });
        console.log(`Email sent successfully to ${contact.email}`);
      } catch (error) {
        results.push({ email: contact.email, status: 'error', message: error.message });
        console.error(`Failed to send email to ${contact.email}:`, error.message);
      }
    }

    console.log('Finished sending emails to the contact list.');
    return results;
  }

  try {
    // You can choose which operation to perform based on the event input
    // For this example, we'll do both
    const contacts = await getContacts();
    const contactBasics = contacts.map(contact => ({
      email: contact.email,
      first_name: contact.first_name
    }));
    
    await sendEmailsToList(contacts);

    return {
      statusCode: 200,
      body: JSON.stringify(contactBasics)
    };
  } catch (error) {
    console.error('Error in Lambda function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify('Error in Lambda function: ' + error.message),
    };
  }
};