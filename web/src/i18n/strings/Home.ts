import { registerDict, type LocaleDict } from "../dict";

export const HomeStrings: LocaleDict = {
  en: {
    "Home.archivedToggle": "archived · {count}",
    "Home.channelsLabel": "Groups",
    "Home.noParticipants": "no participants yet",
    "Home.loading": "loading…",
    "Home.channelsEmpty": "No channels yet — create one with the button above.",
    "Home.channelCategoryAll": "All ({count})",
    "Home.channelCategoryCreated": "Created ({count})",
    "Home.channelCategoryJoined": "Joined ({count})",
    "Home.channelCategoryEmptyCreated": "No channels created by you yet.",
    "Home.channelCategoryEmptyJoined": "You haven't joined any channels yet.",
  },
  zh: {
    "Home.archivedToggle": "归档 · {count}",
    "Home.channelsLabel": "群组",
    "Home.noParticipants": "尚无参与者",
    "Home.loading": "加载中…",
    "Home.channelsEmpty": "还没有群组，点击「新建群组」开始协作。",
    "Home.channelCategoryAll": "全部 ({count})",
    "Home.channelCategoryCreated": "创建 ({count})",
    "Home.channelCategoryJoined": "加入 ({count})",
    "Home.channelCategoryEmptyCreated": "我创建的：暂无频道。",
    "Home.channelCategoryEmptyJoined": "我加入的：暂无频道。",
  },
};

registerDict(HomeStrings);
