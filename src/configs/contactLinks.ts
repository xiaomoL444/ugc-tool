const bilibiliIcon = new URL("../assets/svg/Bilibili.svg", import.meta.url).href;
const discordIcon = new URL("../assets/svg/Discord.svg", import.meta.url).href;
const qqIcon = new URL("../assets/svg/QQ.svg", import.meta.url).href;

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
  {
    platform: "QQ",
    label: "曉末L444",
    href: "https://qun.qq.com/universal-share/share?ac=1&authKey=GjcTdNr41Zecn%2BNpA2gInbCmwuBbC7sumF8y88pf8/BB1tJXrz53dxwWmuRtUeVj&busi_data=eyJncm91cENvZGUiOiI4NjMxODQ3ODAiLCJ0b2tlbiI6IlZaSHZhakx4TkVueFdRdUdheE94L1lFc1JvTk1SNHFpa3M2ZVpGbXVMQ21TYWd3cVE0OCtYd2M0d2tZU29RRzIiLCJ1aW4iOiIzMjk4MTk2NDAwIn0=&data=wnakUzST3wl5KMAmIQst4KlE_diytV5hsK9ESGbDwnRcFMy38bpShZE4Dw1e0wPAqFtHUaafA67h-KNSoUwhJ2IhKsoYJCZ6QCVN7hlut5Y&svctype=5&tempid=h5_group_info",
    image: qqIcon,
    color: "#1263a0",
  },
];
