import { NextResponse } from "next/server";
import { getSocialRepository } from "@/server/repositories/postgres-social-repository";
import { isRejectedRelevance } from "@/domain/social-listening/relevance";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const repo = getSocialRepository();
    const post = await repo.getPost(id);

    if (!post || isRejectedRelevance(post.relevanceStatus)) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const [comments, snapshots] = await Promise.all([
      repo.listComments({ postId: id }),
      repo.listSnapshots(id),
    ]);

    return NextResponse.json({ post, comments, snapshots });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load post";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

