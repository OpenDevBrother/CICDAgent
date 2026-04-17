const API_BASE = process.env.MINDFLAYER_API_BASE_URL || "http://54.86.96.217";
const API_KEY = process.env.MINDFLAYER_API_KEY || "";
const SKILL_ID = process.env.ALEXA_ALLOWED_APP_ID || "";

async function callAPI(method, path, body) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  return res.json();
}

function speak(speech, shouldEnd = true) {
  return {
    version: "1.0",
    response: {
      outputSpeech: {
        type: "PlainText",
        text: speech,
      },
      shouldEndSession: shouldEnd,
    },
  };
}

export const handler = async (event) => {
  // Verify skill ID
  if (SKILL_ID && event.session?.application?.applicationId !== SKILL_ID) {
    return speak("Unauthorized skill.");
  }

  const type = event.request?.type;
  const intentName = event.request?.intent?.name;
  const slots = event.request?.intent?.slots || {};

  console.log("EVENT:", JSON.stringify({ type, intentName, slots }));

  // Launch request
  if (type === "LaunchRequest") {
    return speak(
      "Mind Flayer is ready. You can say: show pull requests, run PR 1, what is the status, or ask about something.",
      false
    );
  }

  // Intent request
  if (type === "IntentRequest") {
    try {
      switch (intentName) {
        case "ListPRsIntent": {
          const data = await callAPI("GET", "/api/alexa/prs");
          return speak(data.speech || "Could not fetch pull requests.");
        }

        case "RunPipelineIntent": {
          const prNum = slots.pr_number?.value;
          if (!prNum) return speak("Which PR number should I run?", false);
          const data = await callAPI("POST", "/api/alexa/run", { pr_number: parseInt(prNum) });
          return speak(data.speech || "Failed to start pipeline.");
        }

        case "PipelineStatusIntent": {
          const data = await callAPI("GET", "/api/alexa/status");
          return speak(data.speech || "Could not get status.");
        }

        case "DeployCheckIntent": {
          const data = await callAPI("GET", "/api/alexa/deploy-check");
          return speak(data.speech || "Could not check deploy status.");
        }

        case "AskKnowledgeIntent": {
          const query = slots.query?.value;
          if (!query) return speak("What would you like to ask about?", false);
          const data = await callAPI("POST", "/api/alexa/ask", { query });
          return speak(data.speech || "I could not find an answer.");
        }

        case "ImpactAnalysisIntent": {
          const target = slots.target?.value;
          if (!target) return speak("Which file or function should I analyze?", false);
          const data = await callAPI("POST", "/api/alexa/impact", { target });
          return speak(data.speech || "Impact analysis failed.");
        }

        case "AMAZON.HelpIntent":
          return speak(
            "You can say: show pull requests, run PR 1, what is the status, is it safe to deploy, ask about auth, or impact of validators.",
            false
          );

        case "AMAZON.StopIntent":
        case "AMAZON.CancelIntent":
          return speak("Goodbye.");

        default:
          return speak("I did not understand that. Try: show pull requests, or ask about something.", false);
      }
    } catch (err) {
      return speak("Mind Flayer is unreachable. Please check that the server is running.");
    }
  }

  // Session ended
  if (type === "SessionEndedRequest") {
    return speak("");
  }

  return speak("Something went wrong.", false);
};
