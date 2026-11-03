import type { ComponentType, SVGProps } from 'react';
import { cn } from 'cn';
import {
  faArrowDownWideShort as regularArrowDownWideNarrow,
  faArrowLeft as regularArrowLeft,
  faArrowRight as regularArrowRight,
  faArrowUp as regularArrowUp,
  faArrowUpRight as regularArrowUpRight,
  faBell as regularBell,
  faBookOpen as regularBookOpen,
  faBuilding as regularBuilding2,
  faCheck as regularCheck,
  faCheckDouble as regularCheckCheck,
  faChevronDown as regularChevronDown,
  faCircleQuestion as regularCircleHelp,
  faCode as regularCodeXml,
  faCopy as regularCopy,
  faCreditCard as regularCreditCard,
  faFileCode as regularFileCode2,
  faFilter as regularFilter,
  faFlag as regularFlag,
  faBook as regularFolderGit2,
  faCodeFork as regularGitFork,
  faCodePullRequest as regularGitPullRequest,
  faCodePullRequestDraft as regularGitPullRequestDraft,
  faCodePullRequestClosed as regularGitPullRequestClosed,
  faCodeMerge as regularGitMerge,
  faKey as regularKeyRound,
  faLayerGroup as regularLayers,
  faLink as regularLink2,
  faListTree as regularListTree,
  faLock as regularLock,
  faEnvelope as regularMail,
  faBars as regularMenu,
  faMessage as regularMessageSquare,
  faMessages as regularMessagesSquare,
  faSidebar as regularPanelLeftClose,
  faPlus as regularPlus,
  faArrowsRotate as regularRefreshCw,
  faMagnifyingGlass as regularSearch,
  faPaperPlane as regularSend,
  faGear as regularSettings,
  faSliders as regularSettings2,
  faShieldCheck as regularShieldCheck,
  faSparkles as regularSparkles,
  faSquare as regularSquare,
  faStar as regularStar,
  faTrashCan as regularTrash2,
  faUser as regularUserRound,
  faUsers as regularUsers,
  faXmark as regularX,
  faFolder as regularFolder,
  faEllipsis as regularMoreHorizontal,
  faChevronsUpDown as regularChevronsUpDown,
  faArrowRightFromBracket as regularLogOut,
} from '@awesome.me/kit-2e791c163e/icons/sharp/regular';
import {
  faArrowDownWideShort as solidArrowDownWideNarrow,
  faArrowLeft as solidArrowLeft,
  faArrowRight as solidArrowRight,
  faArrowUp as solidArrowUp,
  faArrowUpRight as solidArrowUpRight,
  faBell as solidBell,
  faBookOpen as solidBookOpen,
  faBuilding as solidBuilding2,
  faCheck as solidCheck,
  faCheckDouble as solidCheckCheck,
  faChevronDown as solidChevronDown,
  faCircleQuestion as solidCircleHelp,
  faCode as solidCodeXml,
  faCopy as solidCopy,
  faCreditCard as solidCreditCard,
  faFileCode as solidFileCode2,
  faFilter as solidFilter,
  faFlag as solidFlag,
  faBook as solidFolderGit2,
  faCodeFork as solidGitFork,
  faCodePullRequest as solidGitPullRequest,
  faCodePullRequestDraft as solidGitPullRequestDraft,
  faCodePullRequestClosed as solidGitPullRequestClosed,
  faCodeMerge as solidGitMerge,
  faKey as solidKeyRound,
  faLayerGroup as solidLayers,
  faLink as solidLink2,
  faListTree as solidListTree,
  faLock as solidLock,
  faEnvelope as solidMail,
  faBars as solidMenu,
  faMessage as solidMessageSquare,
  faMessages as solidMessagesSquare,
  faSidebar as solidPanelLeftClose,
  faPlus as solidPlus,
  faArrowsRotate as solidRefreshCw,
  faMagnifyingGlass as solidSearch,
  faPaperPlane as solidSend,
  faGear as solidSettings,
  faSliders as solidSettings2,
  faShieldCheck as solidShieldCheck,
  faSparkles as solidSparkles,
  faSquare as solidSquare,
  faStar as solidStar,
  faTrashCan as solidTrash2,
  faUser as solidUserRound,
  faUsers as solidUsers,
  faXmark as solidX,
  faFolder as solidFolder,
  faEllipsis as solidMoreHorizontal,
  faChevronsUpDown as solidChevronsUpDown,
  faArrowRightFromBracket as solidLogOut,
} from '@awesome.me/kit-2e791c163e/icons/sharp/solid';

export type AppIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'width' | 'height'> & {
  readonly size?: number | string;
  readonly active?: boolean;
};
export type AppIcon = ComponentType<AppIconProps>;
type IconDefinition = typeof regularArrowLeft;

function paths(definition: IconDefinition) {
  const data = definition.icon[4];
  return (typeof data === 'string' ? [data] : data).map((d, index) => <path key={index} d={d} />);
}

function glyph(regular: IconDefinition, solid: IconDefinition): AppIcon {
  return function Glyph({ size = 16, active, className, ...props }: AppIconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        className={cn('app-icon', className)}
        {...props}
        data-icon={regular.iconName}
        data-icon-active={active}
      >
        <svg width="24" height="24" viewBox={`0 0 ${regular.icon[0]} ${regular.icon[1]}`} data-icon-weight="regular">
          {paths(regular)}
        </svg>
        <svg width="24" height="24" viewBox={`0 0 ${solid.icon[0]} ${solid.icon[1]}`} data-icon-weight="solid">
          {paths(solid)}
        </svg>
      </svg>
    );
  };
}

export const ArrowDownWideNarrow = glyph(regularArrowDownWideNarrow, solidArrowDownWideNarrow);
export const ArrowLeft = glyph(regularArrowLeft, solidArrowLeft);
export const ArrowRight = glyph(regularArrowRight, solidArrowRight);
export const ArrowUp = glyph(regularArrowUp, solidArrowUp);
export const ArrowUpRight = glyph(regularArrowUpRight, solidArrowUpRight);
export const Bell = glyph(regularBell, solidBell);
export const BookOpen = glyph(regularBookOpen, solidBookOpen);
export const Building2 = glyph(regularBuilding2, solidBuilding2);
export const Check = glyph(regularCheck, solidCheck);
export const CheckCheck = glyph(regularCheckCheck, solidCheckCheck);
export const ChevronDown = glyph(regularChevronDown, solidChevronDown);
export const CircleHelp = glyph(regularCircleHelp, solidCircleHelp);
export const CodeXml = glyph(regularCodeXml, solidCodeXml);
export const Copy = glyph(regularCopy, solidCopy);
export const CreditCard = glyph(regularCreditCard, solidCreditCard);
export const FileCode2 = glyph(regularFileCode2, solidFileCode2);
export const Filter = glyph(regularFilter, solidFilter);
export const Flag = glyph(regularFlag, solidFlag);
export const FolderGit2 = glyph(regularFolderGit2, solidFolderGit2);
export const GitFork = glyph(regularGitFork, solidGitFork);
export const GitPullRequest = glyph(regularGitPullRequest, solidGitPullRequest);
export const GitPullRequestDraft = glyph(regularGitPullRequestDraft, solidGitPullRequestDraft);
export const GitPullRequestClosed = glyph(regularGitPullRequestClosed, solidGitPullRequestClosed);
export const GitMerge = glyph(regularGitMerge, solidGitMerge);
export const KeyRound = glyph(regularKeyRound, solidKeyRound);
export const Layers = glyph(regularLayers, solidLayers);
export const Link2 = glyph(regularLink2, solidLink2);
export const ListTree = glyph(regularListTree, solidListTree);
export const Lock = glyph(regularLock, solidLock);
export const Mail = glyph(regularMail, solidMail);
export const Menu = glyph(regularMenu, solidMenu);
export const MessageSquare = glyph(regularMessageSquare, solidMessageSquare);
export const MessagesSquare = glyph(regularMessagesSquare, solidMessagesSquare);
export const PanelLeftClose = glyph(regularPanelLeftClose, solidPanelLeftClose);
export const Plus = glyph(regularPlus, solidPlus);
export const RefreshCw = glyph(regularRefreshCw, solidRefreshCw);
export const Search = glyph(regularSearch, solidSearch);
export const Send = glyph(regularSend, solidSend);
export const Settings = glyph(regularSettings, solidSettings);
export const Settings2 = glyph(regularSettings2, solidSettings2);
export const ShieldCheck = glyph(regularShieldCheck, solidShieldCheck);
export const Sparkles = glyph(regularSparkles, solidSparkles);
export const Square = glyph(regularSquare, solidSquare);
export const Star = glyph(regularStar, solidStar);
export const Trash2 = glyph(regularTrash2, solidTrash2);
export const UserRound = glyph(regularUserRound, solidUserRound);
export const Users = glyph(regularUsers, solidUsers);
export const X = glyph(regularX, solidX);
export const Folder = glyph(regularFolder, solidFolder);
export const MoreHorizontal = glyph(regularMoreHorizontal, solidMoreHorizontal);
export const ChevronsUpDown = glyph(regularChevronsUpDown, solidChevronsUpDown);
export const LogOut = glyph(regularLogOut, solidLogOut);
