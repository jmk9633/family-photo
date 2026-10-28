'use no memo';
// 위젯은 화면 없이 JSX를 위젯 설계도로 바꿔 그린다. React Compiler가 바꾼 함수(useMemoCache 훅)는 거기서 'Invalid Hook Call'로 실패해서
// 이 파일은 컴파일러를 끈다 (react-native-android-widget 안내, 10/28 가상 폰에서 실제로 겪음).
import { FlexWidget, ImageWidget, OverlapWidget, TextWidget } from 'react-native-android-widget';

import { easyColors } from '@/components/easy/tokens';
import { ko } from '@/copy/ko';

import { parseDate, type Snapshot } from './feed';

// 안드로이드 홈 화면 위젯 모양 (8-3). iOS 위젯(targets/widget/FamilyPhotoWidget.swift)과 같은 모양·규칙:
//   - 큰 것: 사진을 꽉 채우고 위에 '새 사진 N장', 아래에 제목과 'OO이 보냄 · 오늘' (아래쪽을 어둡게 해서 글씨가 보이게)
//   - 중간: 사진 왼쪽, 글 오른쪽 (흰 바탕)
//   - 새 사진이 없으면 배지를 숨긴다. 글씨는 쉬운 화면 기준(18 이상).
//   - 어디를 눌러도 familyphoto://widget → 앱의 +native-intent·_layout이 모드에 맞는 홈으로 보낸다.
// 위젯 칸이 정해져 있어 폰의 '글자 크기' 설정으로 글씨가 커지면 넘쳐 잘리므로 글씨 크기는 고정한다(이미 18 이상).

export const WIDGET_NAMES = { large: 'FamilyPhotoLarge', medium: 'FamilyPhotoMedium' } as const;
export type WidgetName = (typeof WIDGET_NAMES)[keyof typeof WIDGET_NAMES];

const OPEN = { clickAction: 'OPEN_URI', clickActionData: { uri: 'familyphoto://widget' } } as const;
const ACCENT = easyColors.accent as `#${string}`;
const TEXT = easyColors.text as `#${string}`;
const PLACEHOLDER = '#8C8C8C' as const;
const RADIUS = 20;

/** 'OO이 보냄 · 오늘' (날짜는 그리는 때 한국 시간으로 정한다) */
function senderLine(snap: Snapshot, now = new Date()): string {
  const created = parseDate(snap.createdAt);
  let day: string | null = null;
  if (created) {
    const kst = (d: Date) => new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const c = kst(created);
    const n = kst(now);
    const key = (d: Date) => d.toISOString().slice(0, 10);
    const y = kst(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    if (key(c) === key(n)) day = ko.widget.today;
    else if (key(c) === key(y)) day = ko.widget.yesterday;
    else if (c.getUTCFullYear() === n.getUTCFullYear()) day = ko.date.day(c.getUTCMonth() + 1, c.getUTCDate());
    else day = ko.date.dayWithYear(c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate());
  }
  return [snap.sender, day].filter(Boolean).join(' · ');
}

/** 사진을 상자에 찌그러짐 없이 꽉 채우는 크기 (넘치는 쪽은 가운데 기준으로 잘린다) */
function coverSize(snap: Snapshot, boxW: number, boxH: number): { w: number; h: number } {
  if (!snap.imageWidth || !snap.imageHeight) return { w: boxW, h: boxH };
  const scale = Math.max(boxW / snap.imageWidth, boxH / snap.imageHeight);
  return { w: Math.ceil(snap.imageWidth * scale), h: Math.ceil(snap.imageHeight * scale) };
}

function Photo({ snap, width, height, radius }: { snap: Snapshot; width: number; height: number; radius: number }) {
  if (!snap.image) {
    return <FlexWidget style={{ width, height, backgroundColor: PLACEHOLDER, borderRadius: radius }} />;
  }
  const size = coverSize(snap, width, height);
  return (
    <ImageWidget
      image={snap.image as `data:image${string}`}
      imageWidth={size.w}
      imageHeight={size.h}
      resizeMode="cover"
      radius={radius}
      style={{ width, height }}
    />
  );
}

function Badge({ count }: { count: number }) {
  return (
    <FlexWidget style={{ backgroundColor: ACCENT, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
      <TextWidget text={ko.widget.newCount(count)} allowFontScaling={false} style={{ fontSize: 18, fontWeight: 'bold', color: '#FFFFFF' }} />
    </FlexWidget>
  );
}

/** 사진이 없을 때의 안내 (연결 전·사진 없음·인터넷 안 됨) */
function Message({ text }: { text: string }) {
  return (
    <FlexWidget
      {...OPEN}
      accessibilityLabel={ko.widget.a11y}
      style={{
        width: 'match_parent',
        height: 'match_parent',
        backgroundColor: '#FFFFFF',
        borderRadius: RADIUS,
        padding: 16,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <TextWidget
        text={text}
        allowFontScaling={false}
        maxLines={3}
        style={{ fontSize: 20, fontWeight: 'bold', color: TEXT, textAlign: 'center' }}
      />
    </FlexWidget>
  );
}

function LargeView({ snap, width, height }: { snap: Snapshot; width: number; height: number }) {
  const hasTitle = !!snap.title;
  return (
    <OverlapWidget {...OPEN} accessibilityLabel={ko.widget.a11y} style={{ width, height, borderRadius: RADIUS, overflow: 'hidden' }}>
      <Photo snap={snap} width={width} height={height} radius={RADIUS} />
      {/* 아래쪽 글씨가 사진 위에서도 잘 읽히게 어둡게 (위쪽은 배지 자리만 살짝) */}
      <FlexWidget
        style={{
          width,
          height,
          borderRadius: RADIUS,
          backgroundGradient: { from: 'rgba(0, 0, 0, 0)', to: 'rgba(0, 0, 0, 0.75)', orientation: 'TOP_BOTTOM' },
        }}
      />
      <FlexWidget
        style={{ width, height, padding: 16, flexDirection: 'column', justifyContent: 'space-between' }}
      >
        {snap.isNew && snap.count > 0 ? <Badge count={snap.count} /> : <FlexWidget style={{ height: 1, width: 1 }} />}
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
          {hasTitle ? (
            <TextWidget
              text={snap.title ?? ''}
              allowFontScaling={false}
              maxLines={2}
              truncate="END"
              style={{ fontSize: 22, fontWeight: 'bold', color: '#FFFFFF' }}
            />
          ) : null}
          <TextWidget
            text={senderLine(snap)}
            allowFontScaling={false}
            maxLines={1}
            truncate="END"
            style={{ fontSize: 18, fontWeight: hasTitle ? 'normal' : 'bold', color: '#FFFFFF', marginTop: hasTitle ? 4 : 0 }}
          />
        </FlexWidget>
      </FlexWidget>
    </OverlapWidget>
  );
}

function MediumView({ snap, width, height }: { snap: Snapshot; width: number; height: number }) {
  const pad = 12;
  const side = Math.max(0, Math.min(height - pad * 2, width / 2));
  const hasTitle = !!snap.title;
  return (
    <FlexWidget
      {...OPEN}
      accessibilityLabel={ko.widget.a11y}
      style={{
        width,
        height,
        backgroundColor: '#FFFFFF',
        borderRadius: RADIUS,
        padding: pad,
        flexDirection: 'row',
        alignItems: 'center',
        flexGap: 14,
      }}
    >
      <Photo snap={snap} width={side} height={side} radius={14} />
      <FlexWidget style={{ flex: 1, height: 'match_parent', flexDirection: 'column', justifyContent: 'center' }}>
        {snap.isNew && snap.count > 0 ? <Badge count={snap.count} /> : null}
        {hasTitle ? (
          <TextWidget
            text={snap.title ?? ''}
            allowFontScaling={false}
            maxLines={2}
            truncate="END"
            style={{ fontSize: 20, fontWeight: 'bold', color: TEXT, marginTop: 6 }}
          />
        ) : null}
        <TextWidget
          text={senderLine(snap)}
          allowFontScaling={false}
          maxLines={2}
          truncate="END"
          style={{ fontSize: 18, fontWeight: hasTitle ? 'normal' : 'bold', color: TEXT, marginTop: 6 }}
        />
      </FlexWidget>
    </FlexWidget>
  );
}

/** 위젯 하나를 그린다. width·height는 위젯 칸 크기(dp) */
export function FamilyPhotoWidget({
  name,
  snap,
  width,
  height,
}: {
  name: string;
  snap: Snapshot;
  width: number;
  height: number;
}) {
  if (snap.state === 'connect') return <Message text={ko.widget.connect} />;
  if (snap.state === 'empty') return <Message text={ko.widget.empty} />;
  if (snap.state === 'unavailable') return <Message text={ko.widget.unavailable} />;
  return name === WIDGET_NAMES.medium ? (
    <MediumView snap={snap} width={width} height={height} />
  ) : (
    <LargeView snap={snap} width={width} height={height} />
  );
}
