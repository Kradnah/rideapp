import { Injectable } from '@nestjs/common';
import type { Me, UpdateMeRequest } from '@rideapp/contracts';
import { ApiException } from '../../common/errors/api.exception.js';
import type { User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export function toMe(user: User): Me {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    status: user.status,
    hasPassword: user.passwordHash !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Servicio público del módulo de usuarios: otros módulos no tocan la tabla `users` (3). */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findActiveById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { email, deletedAt: null } });
  }

  async getMe(id: string): Promise<Me> {
    const user = await this.findActiveById(id);
    if (!user) throw new ApiException(404, 'NOT_FOUND', 'No encontrado');
    return toMe(user);
  }

  async updateMe(id: string, data: UpdateMeRequest): Promise<Me> {
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(data.fullName !== undefined && { fullName: data.fullName }),
        ...(data.phone !== undefined && { phone: data.phone }),
      },
    });
    return toMe(user);
  }
}
