const bilibiliIcon = new URL("../assets/svg/Bilibili.svg", import.meta.url).href;
const discordIcon = new URL("../assets/svg/Discord.svg", import.meta.url).href;

export interface ContactLink {
  /** Platform or contact method displayed beside the icon. */
  platform: string;
  /** Account name or action displayed in the colored half. */
  label: string;
  href: string;
  /** Local imported image or an HTTPS image URL. */
  image: string;
  color: string;
}

export const contactLinks: ContactLink[] = [
  {
    platform: "Bilibili",
    label: "戀祈",
    href: "https://space.bilibili.com/609872107",
    image: bilibiliIcon,
    color: "#a72a59",
  },
  {
    platform: "Discord",
    label: "xiaomoL444 · Replies may be slow",
    href: "https://discord.com/users/437418965531099136",
    image: discordIcon,
    color: "#4752c4",
  },
];
