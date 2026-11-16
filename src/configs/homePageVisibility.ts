import homePageData from "./homePage.json";

export const homePageCategories = homePageData.categories.map(category => {
  if (process.env.VUE_APP_ENABLE_HUMANOID_OBJECTS_VIEWER === "true" || category.id !== "resources") {
    return category;
  }
  return {
    ...category,
    cards: category.cards.filter(card => card.id !== "humanoid"),
  };
});
