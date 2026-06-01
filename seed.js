const bcrypt = require('bcryptjs');

const PASS = bcrypt.hashSync('password123', 10);
const COLORS = ['#0a66c2', '#057642', '#915907', '#b24020', '#7a3eaf', '#0073b1', '#c2410c', '#0e7490', '#9d174d', '#4d7c0f'];
const COVERS = ['#a0c4ff', '#bdb2ff', '#ffc6ff', '#caffbf', '#ffd6a5', '#9bf6ff', '#fdffb6'];

const PEOPLE = [
  { name: 'Aarav Sharma', email: 'aarav@pronet.com', headline: 'Senior Software Engineer at TechCorp · Ex-Google',
    location: 'San Francisco, CA',
    about: "Engineer obsessed with building systems that scale. 8+ years across backend, distributed systems, and developer experience. Currently leading platform engineering at TechCorp.",
    experience: [
      { title: 'Senior Software Engineer', company: 'TechCorp', from: '2022', to: 'Present', description: 'Leading the platform team building internal developer tools.' },
      { title: 'Software Engineer', company: 'Google', from: '2018', to: '2022', description: 'Worked on Google Cloud Spanner.' },
      { title: 'SDE Intern', company: 'Amazon', from: '2017', to: '2018' },
    ],
    education: [{ school: 'IIT Bombay', degree: 'B.Tech, Computer Science', from: '2014', to: '2018' }],
    skills: ['Go', 'Distributed Systems', 'Kubernetes', 'Python', 'PostgreSQL', 'gRPC'] },

  { name: 'Priya Patel', email: 'priya@pronet.com', headline: 'Product Manager at Stripe',
    location: 'New York, NY',
    about: "Product leader focused on payments infrastructure. Previously launched 3 consumer products at zero-to-one stage.",
    experience: [
      { title: 'Senior Product Manager', company: 'Stripe', from: '2021', to: 'Present' },
      { title: 'Product Manager', company: 'Square', from: '2019', to: '2021' },
    ],
    education: [{ school: 'Wharton, UPenn', degree: 'MBA', from: '2017', to: '2019' }],
    skills: ['Product Strategy', 'Payments', 'A/B Testing', 'SQL', 'Roadmapping'] },

  { name: 'Liam Chen', email: 'liam@pronet.com', headline: 'AI/ML Researcher · Building agents · ex-OpenAI',
    location: 'Palo Alto, CA',
    about: "Researcher and builder. Interested in LLM agents, retrieval, and human-AI collaboration. Currently founding an AI startup.",
    experience: [
      { title: 'Founder & CEO', company: 'Stealth AI startup', from: '2024', to: 'Present' },
      { title: 'Research Engineer', company: 'OpenAI', from: '2022', to: '2024' },
    ],
    education: [{ school: 'Stanford University', degree: 'PhD, Computer Science', from: '2017', to: '2022' }],
    skills: ['LLMs', 'PyTorch', 'RLHF', 'Python', 'Research'] },

  { name: 'Sofia Garcia', email: 'sofia@pronet.com', headline: 'UX Designer at Airbnb · Design systems advocate',
    location: 'Barcelona, Spain',
    about: "Designer crafting joyful experiences. I lead the design systems initiative at Airbnb, with prior stints at Figma and IDEO.",
    experience: [
      { title: 'Senior Product Designer', company: 'Airbnb', from: '2022', to: 'Present' },
      { title: 'Product Designer', company: 'Figma', from: '2020', to: '2022' },
    ],
    education: [{ school: 'Royal College of Art', degree: 'MA, Interaction Design', from: '2018', to: '2020' }],
    skills: ['Figma', 'Design Systems', 'User Research', 'Prototyping'] },

  { name: 'Marcus Johnson', email: 'marcus@pronet.com', headline: 'Engineering Manager at Netflix',
    location: 'Los Angeles, CA',
    about: "Manager of managers. I help engineers do their best work. Big believer in psychological safety and small autonomous teams.",
    experience: [
      { title: 'Engineering Manager', company: 'Netflix', from: '2020', to: 'Present' },
      { title: 'Tech Lead', company: 'Hulu', from: '2016', to: '2020' },
    ],
    education: [{ school: 'UC Berkeley', degree: 'BS, EECS', from: '2008', to: '2012' }],
    skills: ['Leadership', 'Hiring', 'Microservices', 'Java', 'AWS'] },

  { name: 'Ananya Iyer', email: 'ananya@pronet.com', headline: 'Data Scientist at Spotify · Music + ML',
    location: 'Stockholm, Sweden',
    about: "I build models that help millions discover music. ML, causal inference, and recsys.",
    experience: [{ title: 'Senior Data Scientist', company: 'Spotify', from: '2021', to: 'Present' }],
    education: [{ school: 'Carnegie Mellon University', degree: 'MS, Machine Learning', from: '2019', to: '2021' }],
    skills: ['Python', 'TensorFlow', 'Recommender Systems', 'A/B Testing', 'SQL'] },

  { name: 'James O\'Connor', email: 'james@pronet.com', headline: 'Founder & CEO at Outline · YC W22',
    location: 'Dublin, Ireland',
    about: "Building the future of asynchronous knowledge work. Previously sold a SaaS to Atlassian.",
    experience: [
      { title: 'Founder & CEO', company: 'Outline', from: '2022', to: 'Present' },
      { title: 'Founder', company: 'Acquired by Atlassian', from: '2018', to: '2021' },
    ],
    education: [{ school: 'Trinity College Dublin', degree: 'BA, Computer Science', from: '2012', to: '2016' }],
    skills: ['Entrepreneurship', 'Fundraising', 'Product', 'TypeScript'] },

  { name: 'Yuki Tanaka', email: 'yuki@pronet.com', headline: 'iOS Engineer at Apple',
    location: 'Tokyo, Japan',
    about: "I build delightful iOS experiences. Currently on the Photos team.",
    experience: [{ title: 'Senior iOS Engineer', company: 'Apple', from: '2019', to: 'Present' }],
    education: [{ school: 'University of Tokyo', degree: 'BS, Computer Science', from: '2013', to: '2017' }],
    skills: ['Swift', 'SwiftUI', 'iOS', 'Metal', 'Core ML'] },

  { name: 'Emma Williams', email: 'emma@pronet.com', headline: 'DevRel Lead at Vercel · Author · Speaker',
    location: 'London, UK',
    about: "Developer advocate, conference speaker, and educator. I love making the web faster and more accessible.",
    experience: [
      { title: 'Head of DevRel', company: 'Vercel', from: '2023', to: 'Present' },
      { title: 'Developer Advocate', company: 'Cloudflare', from: '2020', to: '2023' },
    ],
    education: [{ school: 'Imperial College London', degree: 'BSc, Computing', from: '2014', to: '2018' }],
    skills: ['JavaScript', 'Next.js', 'Public Speaking', 'Writing', 'Web Performance'] },

  { name: 'Diego Ramírez', email: 'diego@pronet.com', headline: 'Cloud Architect at AWS',
    location: 'Mexico City, Mexico',
    about: "Helping enterprises modernize. 12 AWS certifications and counting.",
    experience: [{ title: 'Principal Solutions Architect', company: 'AWS', from: '2018', to: 'Present' }],
    education: [{ school: 'ITAM', degree: 'BS, Computer Science', from: '2008', to: '2012' }],
    skills: ['AWS', 'Terraform', 'Architecture', 'Kubernetes', 'Security'] },

  { name: 'Fatima Al-Hassan', email: 'fatima@pronet.com', headline: 'Cybersecurity Engineer at Microsoft',
    location: 'Dubai, UAE',
    about: "Defending the cloud. Red-team-turned-blue-team. CISSP, OSCP.",
    experience: [{ title: 'Senior Security Engineer', company: 'Microsoft', from: '2021', to: 'Present' }],
    education: [{ school: 'NYU Abu Dhabi', degree: 'BS, Computer Science', from: '2015', to: '2019' }],
    skills: ['Pentesting', 'Cloud Security', 'Azure', 'Python', 'SIEM'] },

  { name: 'Noah Müller', email: 'noah@pronet.com', headline: 'Frontend Engineer at Linear',
    location: 'Berlin, Germany',
    about: "Pixel-perfect interfaces and 60fps animations. I care deeply about craft.",
    experience: [{ title: 'Senior Frontend Engineer', company: 'Linear', from: '2022', to: 'Present' }],
    education: [{ school: 'TU Berlin', degree: 'MSc, HCI', from: '2018', to: '2020' }],
    skills: ['React', 'TypeScript', 'CSS', 'Performance', 'Animation'] },

  { name: 'Olivia Brown', email: 'olivia@pronet.com', headline: 'Tech Recruiter at Meta · Hiring engineers',
    location: 'Austin, TX',
    about: "I connect great engineers with great teams. Always happy to chat about opportunities.",
    experience: [{ title: 'Senior Technical Recruiter', company: 'Meta', from: '2019', to: 'Present' }],
    education: [{ school: 'UT Austin', degree: 'BA, Psychology', from: '2013', to: '2017' }],
    skills: ['Recruiting', 'Sourcing', 'Interviewing', 'Talent Strategy'] },

  { name: 'Rohan Mehta', email: 'rohan@pronet.com', headline: 'Investor at Sequoia Capital',
    location: 'Bangalore, India',
    about: "Backing technical founders building category-defining companies in dev tools, AI, and fintech.",
    experience: [{ title: 'Principal', company: 'Sequoia Capital', from: '2020', to: 'Present' }],
    education: [{ school: 'Harvard Business School', degree: 'MBA', from: '2017', to: '2019' }],
    skills: ['Venture Capital', 'Due Diligence', 'Strategy', 'Fundraising'] },

  { name: 'Hannah Lee', email: 'hannah@pronet.com', headline: 'Marketing Lead at Notion · Brand & Growth',
    location: 'Seoul, South Korea',
    about: "Brand storyteller and growth marketer. I help products find their voice.",
    experience: [{ title: 'Head of Marketing', company: 'Notion', from: '2023', to: 'Present' }],
    education: [{ school: 'Seoul National University', degree: 'BA, Communications', from: '2012', to: '2016' }],
    skills: ['Brand Strategy', 'Content', 'Growth', 'SEO', 'Community'] },
];

const POSTS = [
  { author: 0, content: "Just shipped a major refactor of our database access layer at TechCorp 🚀\n\nMoved from raw SQL to a typed query builder. Eliminated an entire class of runtime bugs and cut query latency by 40%.\n\nThe lesson: types catch bugs your tests never will." },
  { author: 1, content: "Hot take: most A/B test results are noise.\n\nIf you're not pre-registering your hypothesis, accounting for multiple comparisons, and waiting for full statistical power — you're not running an experiment, you're reading tea leaves.\n\nWhat's your team's bar for shipping?" },
  { author: 2, content: "Spent the weekend benchmarking LLM agent frameworks. Some surprising findings:\n\n• Hand-rolled function calling outperforms most frameworks\n• Streaming is non-negotiable for UX\n• 80% of latency lives in retrieval, not generation\n\nWriting up the full report this week.",
    media_type: 'image', media_url: 'https://picsum.photos/seed/llm/800/450' },
  { author: 3, content: "Design systems are products. Treat them like one.\n\n→ Roadmap\n→ Versioning\n→ Documentation\n→ Office hours\n→ Adoption metrics\n\nIf you ship a component and never talk about it again, nobody will use it.",
    media_type: 'image', media_url: 'https://picsum.photos/seed/design/800/450' },
  { author: 4, content: "After 4 years managing engineers, here are the 3 questions I ask in every 1:1:\n\n1. What's draining your energy this week?\n2. What progress are you most proud of?\n3. How can I unblock you?\n\nSimple. Effective. Try it." },
  { author: 5, content: "Our latest recommender model launched today 🎉 Massive jump in week-1 retention.\n\nGrateful for an incredible team. Music + ML is the best job in the world." },
  { author: 6, content: "We just closed our Series A 🎉 $18M led by Sequoia.\n\nBuilding Outline has been the hardest and most rewarding thing I've ever done. We're hiring engineers, designers, and our first DevRel — DM me if you're interested." },
  { author: 7, content: "SwiftUI in iOS 18 finally feels production-ready. The new Observable macro alone is worth the migration.\n\nWhat's your favorite iOS 18 API?" },
  { author: 8, content: "Watch this 60-second demo of our new edge runtime — cold starts under 5ms ⚡",
    media_type: 'video', media_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
  { author: 9, content: "Multi-region active-active is hard. Here's a thread on what nobody tells you about:\n\n• Clock skew is real\n• Conflict resolution is a product decision, not a technical one\n• Your tests need to simulate partitions\n• Most teams don't actually need this — start single-region" },
  { author: 10, content: "PSA: rotate your secrets.\n\nI audited a client last week — found AWS keys from 2019 still active in their CI. Don't be that team.\n\nUse short-lived credentials. Use OIDC. Use a secret manager. Today." },
  { author: 11, content: "Spent 3 days animating one screen transition. Worth it.\n\nGood animation isn't decoration — it's communication. It tells users where things came from and where they're going.",
    media_type: 'image', media_url: 'https://picsum.photos/seed/anim/800/450' },
  { author: 12, content: "If you're an engineer looking for your next role, my best advice: have a portfolio of WORK, not just a resume of jobs.\n\nGitHub. Blog posts. Side projects. Talks. They tell a story your resume can't." },
  { author: 13, content: "Three things great technical founders share:\n\n1. They can explain hard problems simply\n2. They ship faster than seems reasonable\n3. They obsess over the customer, not the product\n\nWho exemplifies these for you?" },
  { author: 14, content: "We rebuilt our marketing site in 3 weeks. Lessons:\n\n• Cut every word twice\n• Show, don't tell — videos > screenshots > diagrams > prose\n• Page weight matters; we got to <100KB\n• Ship to a small % first, measure, then ramp" },
  { author: 0, content: "Reminder: code reviews are about teaching, not gatekeeping.\n\nIf your reviews consist of \"nit:\" comments and nothing else, you're missing the point." },
  { author: 2, content: "Sample size matters more than model size.\n\nA 7B model fine-tuned on 10k great examples beats a 70B model on a generic benchmark for your task. Every. Single. Time." },
  { author: 3, content: "Working on a new component library at Airbnb. Sneak peek of the new button states 👇",
    media_type: 'image', media_url: 'https://picsum.photos/seed/btn/800/500' },
  { author: 6, content: "Hiring lesson: the best engineers I've hired had ONE thing in common — they asked sharp questions in the interview.\n\nNot \"how's the culture?\" Real questions: about architecture, tradeoffs, what's broken, what's hard." },
  { author: 8, content: "Web performance tip of the day: `loading=\"lazy\"` on offscreen images is free LCP improvement.\n\nYou should be using it." },
  { author: 5, content: "Causal inference is the most underrated skill on a data team.\n\nCorrelation analyses ship features that don't move metrics. Causal analyses ship features that do." },
  { author: 11, content: "Hot take: most apps don't need a state management library.\n\nReact's built-ins + React Query handles 95% of cases. Reach for Redux only when you genuinely need it." },
  { author: 4, content: "The hardest part of being a manager isn't the hard conversations.\n\nIt's having them quickly enough. Most managers wait too long. The kindest thing you can do is be direct, early." },
  { author: 7, content: "Just published an open-source SwiftUI animation library. Free, MIT-licensed. Link in comments." },
  { author: 1, content: "Pricing is a product decision.\n\nIf engineering, design, and PM aren't involved in your pricing, you're leaving money — and customer value — on the table." },
];

const COMMENT_TEMPLATES = [
  "Couldn't agree more.",
  "This is gold 🙌",
  "Saving this for later — thanks for sharing!",
  "Disagree on point 2 — happy to chat more.",
  "Exactly what I needed to read today.",
  "Wow, super insightful breakdown.",
  "Have you tried this with smaller teams?",
  "Reposting this to my team's Slack right now.",
  "This matches what we're seeing too.",
  "Bookmarking. Great write-up!",
  "What tooling did you use for the benchmark?",
  "Congrats! Well deserved 🎉",
  "Curious how this scales beyond 1M users.",
  "100%. Underrated take.",
  "Following — would love to hear more.",
];

function seed(db) {
  const now = Date.now();
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    db.users.push({
      id: ++db.seq.users, name: p.name, email: p.email.toLowerCase(),
      password_hash: PASS,
      headline: p.headline, about: p.about, location: p.location,
      experience: p.experience, education: p.education, skills: p.skills,
      avatar_color: COLORS[i % COLORS.length],
      cover_color: COVERS[i % COVERS.length],
      created_at: now - (PEOPLE.length - i) * 86400000,
    });
  }

  // Posts
  for (let i = 0; i < POSTS.length; i++) {
    const p = POSTS[i];
    db.posts.push({
      id: ++db.seq.posts,
      user_id: db.users[p.author].id,
      content: p.content,
      media_type: p.media_type || null,
      media_url: p.media_url || null,
      created_at: now - i * 3600 * 1000 - Math.floor(Math.random() * 1800 * 1000),
    });
  }

  // Reactions — each post gets several random reactions of varied types
  const RXTYPES = ['like', 'like', 'like', 'heart', 'clap', 'appreciate', 'amazed'];
  for (const post of db.posts) {
    const likerCount = 3 + Math.floor(Math.random() * 8);
    const liked = new Set();
    while (liked.size < likerCount) {
      const uid = db.users[Math.floor(Math.random() * db.users.length)].id;
      if (uid !== post.user_id) liked.add(uid);
    }
    for (const uid of liked) db.likes.push({
      user_id: uid, post_id: post.id,
      type: RXTYPES[Math.floor(Math.random() * RXTYPES.length)],
      created_at: post.created_at + 60000,
    });
  }

  // Comments
  for (const post of db.posts) {
    const n = 1 + Math.floor(Math.random() * 4);
    for (let j = 0; j < n; j++) {
      const u = db.users[Math.floor(Math.random() * db.users.length)];
      if (u.id === post.user_id) continue;
      db.comments.push({
        id: ++db.seq.comments, user_id: u.id, post_id: post.id,
        content: COMMENT_TEMPLATES[Math.floor(Math.random() * COMMENT_TEMPLATES.length)],
        created_at: post.created_at + (j + 1) * 5 * 60 * 1000,
      });
    }
  }

  // Connections — give each user ~4 random connections to other seeds
  for (const u of db.users) {
    const targets = new Set();
    const target = 3 + Math.floor(Math.random() * 4);
    while (targets.size < target) {
      const other = db.users[Math.floor(Math.random() * db.users.length)];
      if (other.id !== u.id) targets.add(other.id);
    }
    for (const oid of targets) {
      const exists = db.connections.some(c =>
        (c.user_a === u.id && c.user_b === oid) ||
        (c.user_b === u.id && c.user_a === oid));
      if (!exists) db.connections.push({ user_a: u.id, user_b: oid, created_at: now - Math.random() * 30 * 86400000 });
    }
  }

  // Sample messages between a few seed users
  const seedMessages = [
    [0, 1, "Hey Priya! Loved your post on A/B testing. Would you have 15 min next week?"],
    [1, 0, "Aarav! Sure, send me a calendar invite — happy to chat anytime."],
    [2, 6, "James, congrats on the raise! Would love to compare notes on agent infra."],
    [6, 2, "Thanks Liam! Let's def chat. I'll DM you my Calendly."],
    [4, 0, "Aarav — are you open to chatting about a Staff role at Netflix?"],
    [12, 0, "Hi Aarav, I'm Olivia from Meta recruiting. We have some roles I think you'd love."],
  ];
  for (const [from, to, content] of seedMessages) {
    db.messages.push({
      id: ++db.seq.messages, from_id: db.users[from].id, to_id: db.users[to].id,
      content, created_at: now - Math.floor(Math.random() * 5 * 86400000), read: 0,
    });
  }
}

module.exports = { seed };
