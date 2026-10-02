import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  AutocompleteQuery,
  type AutocompleteResponse,
  type PlaceDetails,
  PlaceDetailsQuery,
  ReverseGeocodeQuery,
  type ReverseGeocodeResponse,
} from '@rideapp/contracts';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import { createZodDto } from '../../common/zod/zod-dto.js';
import { GeoService } from './geo.service.js';

class AutocompleteDto extends createZodDto(AutocompleteQuery) {}
class PlaceQueryDto extends createZodDto(PlaceDetailsQuery) {}
class ReverseDto extends createZodDto(ReverseGeocodeQuery) {}
/** Los place_id de Google son base64url; los del proveedor falso, `fake-…`. */
class PlaceParam extends createZodDto(
  z.object({ placeId: z.string().regex(/^[A-Za-z0-9_-]{1,300}$/) }),
) {}

/** Proxy hacia el proveedor de mapas (8.6). Las apps nunca llaman a Google directamente. */
@Roles('PASSENGER')
@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get('autocomplete')
  async autocomplete(
    @CurrentUser() user: AuthUser,
    @Query() { q, sessionToken }: AutocompleteDto,
  ): Promise<AutocompleteResponse> {
    return { suggestions: await this.geo.autocomplete(user.id, q, sessionToken) };
  }

  @Get('place/:placeId')
  place(
    @CurrentUser() user: AuthUser,
    @Param() { placeId }: PlaceParam,
    @Query() { sessionToken }: PlaceQueryDto,
  ): Promise<PlaceDetails> {
    return this.geo.placeDetails(user.id, placeId, sessionToken);
  }

  @Get('reverse')
  async reverse(
    @CurrentUser() user: AuthUser,
    @Query() point: ReverseDto,
  ): Promise<ReverseGeocodeResponse> {
    return { formattedAddress: await this.geo.reverseGeocode(user.id, point) };
  }
}
