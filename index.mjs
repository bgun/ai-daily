import sgMail from '@sendgrid/mail';
import client from '@sendgrid/client';
const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
const s3Client = new S3Client({ region: process.env.AWS_REGION });

export const handler = async (event) => {
  console.log('Function started');

  // Set the SendGrid API key for both mail and client
  console.log('Setting API key');
  const apiKey = process.env.SENDGRID_API_KEY;
  sgMail.setApiKey(apiKey);
  client.setApiKey(apiKey);
  console.log('API key set');

  async function createNewsletter(userEmail) {

    const emailAsKey = (userEmail.replace('@', '_'))+'.json';
    // Retrieve S3 object with the email as key from the 'aidaily_replies' bucket
    let userCustomizations = [];
    try {
      const getObjectParams = {
        Bucket: 'aidaily-replies',
        Key: emailAsKey
      };
      const command = new GetObjectCommand(getObjectParams);
      const response = await s3Client.send(command);
      const streamToString = await new Promise((resolve, reject) => {
        const chunks = [];
        response.Body.on('data', (chunk) => chunks.push(chunk));
        response.Body.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        response.Body.on('error', reject);
      });
      userCustomizations = JSON.parse(streamToString).replies;
      console.log('User replies fetched: ', userCustomizations);
    } catch (error) {
      console.error('Error retrieving S3 object:', error);
      userCustomizations = []; // Default to empty array if retrieval fails
    }

    const userCustomizationString = userCustomizations.map(cust => {
      return cust.text;
    }).join('\n - ');

    const SYSTEM_PROMPT = ``;

    const USER_PROMPT = `
Pretend you are the creator of a daily email newsletter. Create an email with basic HTML formatting, that includes the following sections:
  - An inspirational quote
  - A 2-paragraph write-up of a current event or interesting topic from technology, politics, fashion, entertainment, or science.
  - A link to information where I can learn more about the topic above
  - An human interest story about a real person with a relevant connection to today's newsletter topic
  - A link to learn more about this person's work or life
  - A link to a YouTube video I might enjoy, related to the same topic as the email so far
  - A podcast I might enjoy listening to
The following customizations are also requested:
  - ${userCustomizationString}
The response to this prompt should only the newsletter HTML, with no commentary or additional formatting. The only HTML tags allowed are: div,strong,em,blockquote,table,tr,td,tbody,h1,h2,h3,p,a.
    `;
    console.log('Final user prompt: ', USER_PROMPT);

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
      console.log("Perplexity response: ", JSON.stringify(data));
      const responseBodyFixed = responseBody.replace(/^```html\n|\n```$/g, '');
      return responseBodyFixed;
    } catch (err) {
      console.error('Error fetching from Perplexity API:', err);
      throw err;
    }
  }

  // Function to send email
  async function sendEmail(recipientEmail, recipientFirstName) {
    
    const newsletterContent = await createNewsletter(recipientEmail);
    
    const msg = {
      from: { email: 'mynews@aidaily.me' },
      replyTo: { email: 'reply@reply.aidaily.me' },
      personalizations: [{
        to: [{ email: recipientEmail }],
        dynamic_template_data: {
          customSubject: `Hi ${recipientFirstName}, here&apos;s your daily newsletter!`,
          newsletterContent: newsletterContent
        }
      }],
      template_id: 'd-5ba05dd18198489c9936437081d0b09c',
    };

    console.log('Sending email with payload:', JSON.stringify(msg, null, 2));

    try {
      await sgMail.send(msg);
      return 'Email sent successfully';
    } catch (error) {
      throw new Error('SendGrid error sending email: ' + error);
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
        console.error(`Failed to send email to ${contact.email}:`, error);
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