export function sharedPanelOpen({ userChoice, needsMe }: { userChoice: boolean | null; needsMe: boolean }): boolean {
  return userChoice ?? needsMe;
}
