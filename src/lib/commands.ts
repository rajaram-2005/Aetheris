/** Slash commands available in the composer (shared by the picker and the docs). */
export interface Command { id: string; icon: string; label: string; hint: string }
export const COMMANDS: Command[] = [
  { id: "research", icon: "🔬", label: "/research", hint: "Deep research with sources" },
  { id: "arena", icon: "⚔️", label: "/arena", hint: "Compare several providers side by side" },
  { id: "image", icon: "🎨", label: "/image", hint: "Generate an image in the Studio" },
  { id: "debate", icon: "🥊", label: "/debate", hint: "Two agents argue a motion, Metis judges — /debate <motion>" },
  { id: "workflows", icon: "⛓️", label: "/workflows", hint: "Chain agents into automations" },
  { id: "room", icon: "👥", label: "/room", hint: "Open a live room for this chat" },
  { id: "share", icon: "🔗", label: "/share", hint: "Create a public link to this chat" },
  { id: "new", icon: "✨", label: "/new", hint: "Start a new chat" },
  { id: "agents", icon: "🤖", label: "/agents", hint: "Browse all agents" },
  { id: "gallery", icon: "🗂️", label: "/gallery", hint: "Prompt & agent gallery" },
  { id: "settings", icon: "⚙️", label: "/settings", hint: "Open settings" },
  { id: "export", icon: "⤓", label: "/export", hint: "Download this chat as Markdown" },
];
