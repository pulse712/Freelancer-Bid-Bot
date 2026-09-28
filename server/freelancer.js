const PROJECTS_API = "https://www.freelancer.com/api/projects/0.1/projects/";

function seoUrlFromProjectUrl(url) {
  const match = new URL(url).pathname.match(/^\/projects\/(.+?)\/?$/);
  if (!match) {
    return null;
  }
  return match[1].replace(/\/(details|proposals|reviews|payments|files)$/i, "");
}

function formatBudget(project) {
  const { minimum, maximum } = project.budget || {};
  const sign = project.currency?.sign || "";
  const code = project.currency?.code || "";
  const range = maximum ? `${sign}${minimum}-${sign}${maximum}` : `${sign}${minimum}+`;
  return `${range} ${code}${project.type === "hourly" ? " per hour" : ""}`.trim();
}

async function fetchProject(url) {
  const seoUrl = seoUrlFromProjectUrl(url);
  if (!seoUrl) {
    throw new Error("Not a freelancer.com/projects/... link");
  }

  const query = new URLSearchParams({
    "seo_urls[]": seoUrl,
    full_description: "true",
    job_details: "true"
  });
  const response = await fetch(`${PROJECTS_API}?${query}`, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Freelancer API returned ${response.status}`);
  }
  const project = (await response.json())?.result?.projects?.[0];
  if (!project) {
    throw new Error("Project not found in Freelancer API");
  }

  return {
    id: project.id,
    title: project.title || "",
    description: project.description || "",
    budget: formatBudget(project),
    type: project.type || "",
    skills: (project.jobs || []).map((job) => job.name).join(", "),
    pageUrl: url
  };
}

module.exports = { fetchProject };
